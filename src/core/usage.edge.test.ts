import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandRunner } from './providers.js';
import type { Account } from './types.js';
import { UsageError, readUsage } from './usage.js';
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
