import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandRunner } from './providers.js';
import type { Account, ProviderId } from './types.js';
import { readUsage, UsageError } from './usage.js';
import type { UsageDeps } from './usage.js';

const TOKEN = 'sk-ant-oat01-secret-token';
const NOW = new Date('2026-11-12T12:00:00.000Z');

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'inova-usage-'));
});

function account(provider: ProviderId): Account {
  return { id: 'a1', provider, label: 'test', homeDir, createdAt: NOW.toISOString() };
}

type RunResult = Awaited<ReturnType<CommandRunner['run']>>;
type FetchInit = Parameters<UsageDeps['fetch']>[1];

interface Recorder {
  deps: UsageDeps;
  commands: { command: string; args: string[] }[];
  requests: { url: string; init: FetchInit }[];
}

function credentialsJson(): string {
  return JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: 1 } });
}

async function fixtureBody(): Promise<unknown> {
  const raw = await readFile(new URL('./fixtures/claude-usage.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

function recorder(options: {
  platform?: NodeJS.Platform;
  runResult?: RunResult;
  response?: { ok: boolean; status: number; body: unknown };
}): Recorder {
  const commands: Recorder['commands'] = [];
  const requests: Recorder['requests'] = [];
  const response = options.response ?? { ok: true, status: 200, body: {} };
  const deps: UsageDeps = {
    platform: options.platform ?? 'linux',
    now: () => NOW,
    runner: {
      run: (cmd) => {
        commands.push({ command: cmd.command, args: cmd.args });
        return Promise.resolve(options.runResult ?? { notFound: true });
      },
    },
    fetch: (url, init) => {
      requests.push({ url, init });
      return Promise.resolve({
        ok: response.ok,
        status: response.status,
        json: () => Promise.resolve(response.body),
      });
    },
  };
  return { deps, commands, requests };
}

async function captureError(promise: Promise<unknown>): Promise<UsageError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof UsageError)) throw new Error('expected a UsageError');
  return error;
}

describe('readUsage claude', () => {
  it('reads the keychain service derived from sha256 of the home dir on darwin', async () => {
    const rec = recorder({
      platform: 'darwin',
      runResult: { exitCode: 0, stdout: `${credentialsJson()}\n` },
      response: { ok: true, status: 200, body: await fixtureBody() },
    });
    await readUsage({ account: account('claude'), deps: rec.deps });
    const hash = createHash('sha256').update(homeDir).digest('hex').slice(0, 8);
    expect(rec.commands).toEqual([
      {
        command: 'security',
        args: ['find-generic-password', '-s', `Claude Code-credentials-${hash}`, '-w'],
      },
    ]);
  });

  it('prefers the credentials file over the keychain', async () => {
    await writeFile(join(homeDir, '.credentials.json'), credentialsJson());
    const rec = recorder({ platform: 'darwin', response: { ok: true, status: 200, body: {} } });
    await readUsage({ account: account('claude'), deps: rec.deps });
    expect(rec.commands).toEqual([]);
    expect(rec.requests).toHaveLength(1);
  });

  it('does not use the keychain on linux', async () => {
    const rec = recorder({
      platform: 'linux',
      runResult: { exitCode: 0, stdout: credentialsJson() },
    });
    const error = await captureError(readUsage({ account: account('claude'), deps: rec.deps }));
    expect(error.code).toBe('no-credentials');
    expect(rec.commands).toEqual([]);
  });

  it('reports no-credentials when the keychain lookup fails', async () => {
    const missing = recorder({ platform: 'darwin', runResult: { exitCode: 44, stdout: '' } });
    const noBinary = recorder({ platform: 'darwin', runResult: { notFound: true } });
    for (const rec of [missing, noBinary]) {
      const error = await captureError(readUsage({ account: account('claude'), deps: rec.deps }));
      expect(error.code).toBe('no-credentials');
      expect(rec.requests).toEqual([]);
    }
  });

  it('sends the bearer token and beta header to the usage endpoint', async () => {
    await writeFile(join(homeDir, '.credentials.json'), credentialsJson());
    const rec = recorder({ platform: 'linux' });
    await readUsage({ account: account('claude'), deps: rec.deps });
    expect(rec.requests[0]?.url).toBe('https://api.anthropic.com/api/oauth/usage');
    expect(rec.requests[0]?.init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'anthropic-beta': 'oauth-2025-04-20',
    });
    expect(rec.requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('readUsage claude response', () => {
  beforeEach(async () => {
    await writeFile(join(homeDir, '.credentials.json'), credentialsJson());
  });

  it('maps the fixture response to session and weekly windows', async () => {
    const rec = recorder({
      platform: 'linux',
      response: { ok: true, status: 200, body: await fixtureBody() },
    });
    const snapshot = await readUsage({ account: account('claude'), deps: rec.deps });
    expect(snapshot).toEqual({
      provider: 'claude',
      source: 'api',
      fetchedAt: NOW.toISOString(),
      windows: [
        { kind: 'session', usedPercent: 9, resetsAt: '2026-11-13T01:00:00.858Z' },
        { kind: 'weekly', usedPercent: 2, resetsAt: '2026-11-19T20:00:00.858Z' },
      ],
    });
  });

  it('clamps utilization and drops invalid windows', async () => {
    const body = {
      five_hour: { utilization: 140, resets_at: null },
      seven_day: { utilization: 'high', resets_at: '2026-11-19T20:00:00Z' },
    };
    const rec = recorder({ platform: 'linux', response: { ok: true, status: 200, body } });
    const snapshot = await readUsage({ account: account('claude'), deps: rec.deps });
    expect(snapshot.windows).toEqual([{ kind: 'session', usedPercent: 100, resetsAt: null }]);
  });

  it('includes monthly window when enabled in extra_usage', async () => {
    const body = {
      five_hour: { utilization: 10, resets_at: '2026-11-13T01:00:00Z' },
      extra_usage: { is_enabled: true, utilization: 42.5, resets_at: '2026-12-01T00:00:00Z' },
    };
    const rec = recorder({ platform: 'linux', response: { ok: true, status: 200, body } });
    const snapshot = await readUsage({ account: account('claude'), deps: rec.deps });
    expect(snapshot.windows).toEqual([
      { kind: 'session', usedPercent: 10, resetsAt: '2026-11-13T01:00:00.000Z' },
      { kind: 'monthly', usedPercent: 42.5, resetsAt: '2026-12-01T00:00:00.000Z' },
    ]);
  });

  it('reports http errors with the status but never the token', async () => {
    const rec = recorder({ platform: 'linux', response: { ok: false, status: 401, body: {} } });
    const error = await captureError(readUsage({ account: account('claude'), deps: rec.deps }));
    expect(error.code).toBe('http');
    expect(error.message).toContain('401');
    expect(error.message).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it('reports bad-response for a non-object body', async () => {
    const rec = recorder({ platform: 'linux', response: { ok: true, status: 200, body: 'nope' } });
    const error = await captureError(readUsage({ account: account('claude'), deps: rec.deps }));
    expect(error.code).toBe('bad-response');
  });
});

interface RolloutFile {
  day: string;
  name: string;
  lines: unknown[];
  mtime: Date;
}

async function writeRollout(file: RolloutFile): Promise<void> {
  const dir = join(homeDir, 'sessions', ...file.day.split('-'));
  await mkdir(dir, { recursive: true });
  const path = join(dir, file.name);
  await writeFile(path, file.lines.map((line) => JSON.stringify(line)).join('\n'));
  await utimes(path, file.mtime, file.mtime);
}

function tokenCount(limits: { primary: unknown; secondary: unknown }, timestamp?: string): unknown {
  return {
    ...(timestamp === undefined ? {} : { timestamp }),
    type: 'event_msg',
    payload: { type: 'token_count', rate_limits: limits },
  };
}

describe('readUsage codex', () => {
  it('is unavailable without rollout files', async () => {
    const snapshot = await readUsage({ account: account('codex'), deps: recorder({}).deps });
    expect(snapshot).toMatchObject({ provider: 'codex', windows: [], source: 'unavailable' });
  });

  it('reads the last rate limits of the most recently modified rollout', async () => {
    const limits = (used: number): unknown =>
      tokenCount({ primary: { used_percent: used, resets_at: 1_794_484_800 }, secondary: null });
    await writeRollout({
      day: '2026-11-12',
      name: 'rollout-old.jsonl',
      lines: [limits(70)],
      mtime: new Date('2026-11-12T09:00:00Z'),
    });
    await writeRollout({
      day: '2026-11-11',
      name: 'rollout-new.jsonl',
      lines: [limits(10), limits(25), { type: 'event_msg', payload: { type: 'agent_message' } }],
      mtime: new Date('2026-11-12T11:00:00Z'),
    });
    const snapshot = await readUsage({ account: account('codex'), deps: recorder({}).deps });
    expect(snapshot).toEqual({
      provider: 'codex',
      source: 'rollout',
      fetchedAt: NOW.toISOString(),
      windows: [{ kind: 'session', usedPercent: 25, resetsAt: '2026-11-12T12:00:00.000Z' }],
    });
  });

  it('resolves resets_in_seconds from the line timestamp, else the file mtime', async () => {
    await writeRollout({
      day: '2026-11-12',
      name: 'rollout-a.jsonl',
      lines: [
        tokenCount({
          primary: { used_percent: 150, resets_in_seconds: 600 },
          secondary: { used_percent: 40, resets_in_seconds: 3600 },
        }),
      ],
      mtime: new Date('2026-11-12T10:00:00Z'),
    });
    await writeRollout({
      day: '2026-11-12',
      name: 'rollout-b.jsonl',
      lines: [
        tokenCount(
          {
            primary: { used_percent: 150, resets_in_seconds: 600 },
            secondary: { used_percent: 'x' },
          },
          '2026-11-12T11:00:00.000Z',
        ),
      ],
      mtime: new Date('2026-11-12T11:30:00Z'),
    });
    const fromTimestamp = await readUsage({ account: account('codex'), deps: recorder({}).deps });
    expect(fromTimestamp.windows).toEqual([
      { kind: 'session', usedPercent: 100, resetsAt: '2026-11-12T11:10:00.000Z' },
    ]);
    await utimes(
      join(homeDir, 'sessions', '2026', '11', '12', 'rollout-b.jsonl'),
      new Date('2026-11-12T09:00:00Z'),
      new Date('2026-11-12T09:00:00Z'),
    );
    const fromMtime = await readUsage({ account: account('codex'), deps: recorder({}).deps });
    expect(fromMtime.windows).toEqual([
      { kind: 'session', usedPercent: 100, resetsAt: '2026-11-12T10:10:00.000Z' },
      { kind: 'weekly', usedPercent: 40, resetsAt: '2026-11-12T11:00:00.000Z' },
    ]);
  });

  it('only scans the three newest day directories', async () => {
    const line = tokenCount({ primary: { used_percent: 5 }, secondary: null });
    for (const day of ['2026-11-09', '2026-11-10', '2026-11-11']) {
      await writeRollout({ day, name: 'rollout-x.jsonl', lines: [], mtime: new Date(day) });
    }
    await writeRollout({
      day: '2026-10-01',
      name: 'rollout-x.jsonl',
      lines: [line],
      mtime: new Date('2026-11-12T11:00:00Z'),
    });
    const snapshot = await readUsage({ account: account('codex'), deps: recorder({}).deps });
    expect(snapshot.source).toBe('unavailable');
  });
});

describe('readUsage gemini', () => {
  async function markGeminiLoggedIn(): Promise<void> {
    const dir = join(homeDir, '.gemini', 'antigravity-cli');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'jetski_state.pbtxt'),
      'agent_onboarding_completed:  AGENT_ONBOARDING_STATE_COMPLETED\n',
    );
  }

  it('throws no-credentials without invoking agy when logged out', async () => {
    const rec = recorder({ platform: 'darwin' });
    const error = await captureError(readUsage({ account: account('gemini'), deps: rec.deps }));
    expect(error.code).toBe('no-credentials');
    expect(rec.commands).toEqual([]);
    expect(rec.requests).toEqual([]);
  });

  it('parses session and weekly buckets from agy /usage json output', async () => {
    await markGeminiLoggedIn();
    const payload = {
      conversation_id: '',
      status: 'SUCCESS',
      command: {
        name: 'usage',
        data: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [
                {
                  id: 'gemini-weekly',
                  window: 'weekly',
                  remaining_fraction: 0.33099,
                  reset_time: '2026-11-14T06:00:10Z',
                },
                {
                  id: 'gemini-5h',
                  window: '5h',
                  remaining_fraction: 0.84806,
                  reset_time: '2026-11-13T02:23:20Z',
                },
              ],
            },
          ],
        },
      },
    };
    const rec = recorder({
      platform: 'darwin',
      runResult: { exitCode: 0, stdout: JSON.stringify(payload) },
    });
    const snapshot = await readUsage({ account: account('gemini'), deps: rec.deps });
    expect(rec.commands).toEqual([
      { command: 'agy', args: ['-p', '/usage', '--output-format', 'json'] },
    ]);
    expect(snapshot).toEqual({
      provider: 'gemini',
      windows: [
        { kind: 'session', usedPercent: 15.2, resetsAt: '2026-11-13T02:23:20.000Z' },
        { kind: 'weekly', usedPercent: 66.9, resetsAt: '2026-11-14T06:00:10.000Z' },
      ],
      source: 'api',
      fetchedAt: NOW.toISOString(),
    });
  });

  it('returns unavailable when agy binary is missing', async () => {
    await markGeminiLoggedIn();
    const rec = recorder({ platform: 'darwin', runResult: { notFound: true } });
    const snapshot = await readUsage({ account: account('gemini'), deps: rec.deps });
    expect(snapshot).toEqual({
      provider: 'gemini',
      windows: [],
      source: 'unavailable',
      fetchedAt: NOW.toISOString(),
    });
  });

  it('throws bad-response when agy returns invalid output or non-zero exit', async () => {
    await markGeminiLoggedIn();
    const badExit = recorder({ platform: 'darwin', runResult: { exitCode: 1, stdout: '{}' } });
    const badJson = recorder({ platform: 'darwin', runResult: { exitCode: 0, stdout: 'nope' } });
    for (const rec of [badExit, badJson]) {
      const error = await captureError(readUsage({ account: account('gemini'), deps: rec.deps }));
      expect(error.code).toBe('bad-response');
    }
  });

  it('returns unavailable usage for providers without quota endpoints', async () => {
    for (const id of ['deepseek', 'kimi', 'grok', 'qwen', 'opencode'] as const) {
      const rec = recorder({});
      const snapshot = await readUsage({ account: account(id), deps: rec.deps });
      expect(snapshot).toEqual({
        provider: id,
        windows: [],
        source: 'unavailable',
        fetchedAt: NOW.toISOString(),
      });
    }
  });
});
