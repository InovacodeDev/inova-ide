import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandRunner } from './providers.js';
import type { Account } from './types.js';
import { UsageError, UsageRateLimitError, readUsage, usageCooldownMs } from './usage.js';
import type { UsageDeps } from './usage.js';

const NOW = new Date('2026-11-18T12:00:00.000Z');

const tempDirs: string[] = [];
let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'inova-usage-edge-'));
  tempDirs.push(homeDir);
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function geminiAccount(): Account {
  return {
    id: 'gem-1',
    provider: 'gemini',
    label: 'google-pessoal',
    homeDir,
    createdAt: NOW.toISOString(),
  };
}

async function markGeminiLoggedIn(): Promise<void> {
  const dir = join(homeDir, '.gemini', 'antigravity-cli');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'antigravity-oauth-token'), '{"token":{}}');
}

async function captureError(promise: Promise<unknown>): Promise<UsageError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof UsageError)) throw new Error('expected a UsageError');
  return error;
}

describe('readUsage gemini edge cases', () => {
  it('resolves agy via baseEnv and resolveBinary with isolated env, cwd, and 30s timeout', async () => {
    await markGeminiLoggedIn();
    const resolveCalls: { name: string; env: NodeJS.ProcessEnv }[] = [];
    const runCalls: Parameters<CommandRunner['run']>[0][] = [];
    const deps: UsageDeps = {
      platform: 'darwin',
      now: () => NOW,
      baseEnv: () => ({
        PATH: '/custom/bin:/usr/bin',
        GEMINI_API_KEY: 'secret-gemini',
        GOOGLE_API_KEY: 'secret-google',
      }),
      resolveBinary: (name, env) => {
        resolveCalls.push({ name, env });
        return '/custom/bin/agy';
      },
      fetch: () => Promise.reject(new Error('unused')),
      runner: {
        run: (cmd) => {
          runCalls.push(cmd);
          return Promise.resolve({
            exitCode: 0,
            stdout: JSON.stringify({
              status: 'SUCCESS',
              command: {
                data: {
                  groups: [
                    {
                      name: 'Gemini Models',
                      buckets: [
                        {
                          id: 'gemini-5h',
                          window: '5h',
                          remaining_fraction: 0.75,
                          reset_time: '2026-11-18T17:00:00Z',
                        },
                      ],
                    },
                  ],
                },
              },
            }),
          });
        },
      },
    };

    const snapshot = await readUsage({ account: geminiAccount(), deps });
    expect(resolveCalls).toEqual([
      {
        name: 'agy',
        env: {
          PATH: '/custom/bin:/usr/bin',
          GEMINI_API_KEY: 'secret-gemini',
          GOOGLE_API_KEY: 'secret-google',
        },
      },
    ]);
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]?.command).toBe('/custom/bin/agy');
    expect(runCalls[0]?.args).toEqual(['-p', '/usage', '--output-format', 'json']);
    expect(runCalls[0]?.cwd).toBe(homeDir);
    expect(runCalls[0]?.timeoutMs).toBe(30_000);
    expect(runCalls[0]?.env['PATH']).toBe('/custom/bin:/usr/bin');
    expect(runCalls[0]?.env['HOME']).toBe(homeDir);
    expect(runCalls[0]?.env['SSH_CONNECTION']).toBe('127.0.0.1 0 127.0.0.1 0');
    expect(runCalls[0]?.env['GEMINI_API_KEY']).toBeUndefined();
    expect(runCalls[0]?.env['GOOGLE_API_KEY']).toBeUndefined();
    expect(snapshot).toEqual({
      provider: 'gemini',
      source: 'api',
      fetchedAt: NOW.toISOString(),
      windows: [{ kind: 'session', usedPercent: 25, resetsAt: '2026-11-18T17:00:00.000Z' }],
    });
  });

  it('returns unavailable without running agy when resolveBinary returns undefined', async () => {
    await markGeminiLoggedIn();
    const runCalls: Parameters<CommandRunner['run']>[0][] = [];
    const deps: UsageDeps = {
      platform: 'darwin',
      now: () => NOW,
      baseEnv: () => ({ PATH: '/empty' }),
      resolveBinary: () => undefined,
      fetch: () => Promise.reject(new Error('unused')),
      runner: {
        run: (cmd) => {
          runCalls.push(cmd);
          return Promise.resolve({ exitCode: 0, stdout: '{}' });
        },
      },
    };

    const snapshot = await readUsage({ account: geminiAccount(), deps });
    expect(runCalls).toEqual([]);
    expect(snapshot).toEqual({
      provider: 'gemini',
      windows: [],
      source: 'unavailable',
      fetchedAt: NOW.toISOString(),
    });
  });

  it('parses usage JSON surrounded by ANSI escape codes and extra lines', async () => {
    await markGeminiLoggedIn();
    const payload = {
      status: 'SUCCESS',
      command: {
        data: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [
                {
                  id: 'gemini-weekly',
                  window: 'weekly',
                  remaining_fraction: 0.4,
                  reset_time: null,
                },
              ],
            },
          ],
        },
      },
    };
    const stdout = [
      '\u001b[K⠋ Refreshing token...',
      'Warning: transient lag',
      `\u001b[0m${JSON.stringify(payload)}`,
      'Trailing text',
    ].join('\n');

    const deps: UsageDeps = {
      platform: 'darwin',
      now: () => NOW,
      fetch: () => Promise.reject(new Error('unused')),
      runner: { run: () => Promise.resolve({ exitCode: 0, stdout }) },
    };

    const snapshot = await readUsage({ account: geminiAccount(), deps });
    expect(snapshot.source).toBe('api');
    expect(snapshot.windows).toEqual([{ kind: 'weekly', usedPercent: 60, resetsAt: null }]);
  });

  it('maps expired Antigravity CLI errors to UsageError unauthorized', async () => {
    await markGeminiLoggedIn();
    const depsFor = (runResult: Awaited<ReturnType<CommandRunner['run']>>): UsageDeps => ({
      platform: 'darwin',
      now: () => NOW,
      fetch: () => Promise.reject(new Error('unused')),
      runner: { run: () => Promise.resolve(runResult) },
    });

    const exitAuth = await captureError(
      readUsage({
        account: geminiAccount(),
        deps: depsFor({ exitCode: 1, stdout: 'You are not logged into Antigravity.\n' }),
      }),
    );
    expect(exitAuth.code).toBe('unauthorized');

    const jsonAuth = await captureError(
      readUsage({
        account: geminiAccount(),
        deps: depsFor({
          exitCode: 0,
          stdout: JSON.stringify({ status: 'ERROR', error: 'OAuth token has been revoked' }),
        }),
      }),
    );
    expect(jsonAuth.code).toBe('unauthorized');

    const otherErr = await captureError(
      readUsage({
        account: geminiAccount(),
        deps: depsFor({
          exitCode: 0,
          stdout: JSON.stringify({ status: 'ERROR', message: 'unexpected backend failure' }),
        }),
      }),
    );
    expect(otherErr.code).toBe('bad-response');
  });
});

function claudeAccount(): Account {
  return {
    id: 'cl-1',
    provider: 'claude',
    label: 'pessoal',
    homeDir,
    createdAt: NOW.toISOString(),
  };
}

async function writeClaudeToken(expiresAt: number): Promise<void> {
  await writeFile(
    join(homeDir, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'secret-token', expiresAt } }),
  );
}

function claudeDeps(response: { status: number; retryAfter?: string }): {
  deps: UsageDeps;
  urls: string[];
} {
  const urls: string[] = [];
  const deps: UsageDeps = {
    platform: 'linux',
    now: () => NOW,
    runner: { run: () => Promise.resolve({ notFound: true }) },
    fetch: (url) => {
      urls.push(url);
      return Promise.resolve({
        ok: response.status < 400,
        status: response.status,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'retry-after' ? (response.retryAfter ?? null) : null,
        },
        json: () => Promise.resolve({}),
      });
    },
  };
  return { deps, urls };
}

function retryAfterOf(error: UsageError): number | null {
  if (!(error instanceof UsageRateLimitError)) throw new Error('expected a UsageRateLimitError');
  return error.retryAfterMs;
}

describe('readUsage claude rate limit edge cases', () => {
  it('requires a new login when an expired token has no refresh token', async () => {
    await writeClaudeToken(NOW.getTime());
    const { deps, urls } = claudeDeps({ status: 200 });
    const error = await captureError(readUsage({ account: claudeAccount(), deps }));
    expect(error.code).toBe('unauthorized');
    expect(error.message).not.toContain('secret-token');
    expect(urls).toEqual([]);
  });

  it('maps 429 to a rate-limit error carrying Retry-After seconds', async () => {
    await writeClaudeToken(NOW.getTime() + 3_600_000);
    const { deps } = claudeDeps({ status: 429, retryAfter: '90' });
    const error = await captureError(readUsage({ account: claudeAccount(), deps }));
    expect(error.code).toBe('rate-limited');
    expect(error.status).toBe(429);
    expect(retryAfterOf(error)).toBe(90_000);
  });

  it('parses Retry-After as an HTTP date and ignores garbage', async () => {
    await writeClaudeToken(NOW.getTime() + 3_600_000);
    const dated = claudeDeps({
      status: 429,
      retryAfter: new Date(NOW.getTime() + 300_000).toUTCString(),
    });
    const datedError = await captureError(
      readUsage({ account: claudeAccount(), deps: dated.deps }),
    );
    expect(retryAfterOf(datedError)).toBe(300_000);

    const garbage = claudeDeps({ status: 429, retryAfter: 'soon' });
    const garbageError = await captureError(
      readUsage({ account: claudeAccount(), deps: garbage.deps }),
    );
    expect(retryAfterOf(garbageError)).toBeNull();
  });

  it('handles a 429 response without a headers object', async () => {
    await writeClaudeToken(NOW.getTime() + 3_600_000);
    const deps: UsageDeps = {
      platform: 'linux',
      now: () => NOW,
      runner: { run: () => Promise.resolve({ notFound: true }) },
      fetch: () => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }),
    };
    const error = await captureError(readUsage({ account: claudeAccount(), deps }));
    expect(retryAfterOf(error)).toBeNull();
  });
});

describe('usageCooldownMs', () => {
  it('honors Retry-After when present', () => {
    expect(usageCooldownMs({ retryAfterMs: 45_000, consecutiveFailures: 5 })).toBe(45_000);
  });

  it('backs off exponentially from 2 minutes and caps at 30 minutes', () => {
    const waits = [1, 2, 3, 4, 5, 6].map((consecutiveFailures) =>
      usageCooldownMs({ retryAfterMs: null, consecutiveFailures }),
    );
    expect(waits).toEqual([120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000]);
  });

  it('treats a non-positive failure count as the first failure', () => {
    expect(usageCooldownMs({ retryAfterMs: null, consecutiveFailures: 0 })).toBe(120_000);
  });
});
