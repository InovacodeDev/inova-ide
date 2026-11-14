import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandRunner } from './providers.js';
import type { Account, ProviderId } from './types.js';
import type { UsageSnapshot } from './chat-types.js';
import { exhaustionResetAt, exhaustionVerdict, readUsage, UsageError } from './usage.js';
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
  envs: NodeJS.ProcessEnv[];
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
  const envs: Recorder['envs'] = [];
  const requests: Recorder['requests'] = [];
  const response = options.response ?? { ok: true, status: 200, body: {} };
  const deps: UsageDeps = {
    platform: options.platform ?? 'linux',
    now: () => NOW,
    runner: {
      run: (cmd) => {
        commands.push({ command: cmd.command, args: cmd.args });
        envs.push(cmd.env);
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
  return { deps, commands, envs, requests };
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
        {
          kind: 'weekly',
          usedPercent: 0,
          resetsAt: '2026-11-19T20:00:00.000Z',
          scope: 'Model Name',
        },
      ],
    });
  });

  it('falls back to seven_day_opus and seven_day_sonnet without scoped limits', async () => {
    const body = {
      five_hour: { utilization: 5, resets_at: null },
      seven_day_opus: { utilization: 30, resets_at: '2026-11-19T20:00:00Z' },
      seven_day_sonnet: null,
      limits: [{ kind: 'session', group: 'session', percent: 5, scope: null }],
    };
    const rec = recorder({ platform: 'linux', response: { ok: true, status: 200, body } });
    const snapshot = await readUsage({ account: account('claude'), deps: rec.deps });
    expect(snapshot.windows).toEqual([
      { kind: 'session', usedPercent: 5, resetsAt: null },
      { kind: 'weekly', usedPercent: 30, resetsAt: '2026-11-19T20:00:00.000Z', scope: 'Opus' },
    ]);
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

  it('reports unauthorized when the API rejects a token that is still within its validity', async () => {
    await writeFile(
      join(homeDir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: { accessToken: TOKEN, expiresAt: NOW.getTime() + 3_600_000 },
      }),
    );
    const rec = recorder({ platform: 'linux', response: { ok: false, status: 401, body: {} } });
    const error = await captureError(readUsage({ account: account('claude'), deps: rec.deps }));
    expect(error.code).toBe('unauthorized');
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it('keeps a plain http error for 401 when the access token already expired locally', async () => {
    await writeFile(
      join(homeDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: NOW.getTime() - 1 } }),
    );
    const rec = recorder({ platform: 'linux', response: { ok: false, status: 401, body: {} } });
    const error = await captureError(readUsage({ account: account('claude'), deps: rec.deps }));
    expect(error.code).toBe('http');
    expect(error.message).toContain('401');
  });

  it('reports http errors with the status but never the token', async () => {
    const rec = recorder({ platform: 'linux', response: { ok: false, status: 500, body: {} } });
    const error = await captureError(readUsage({ account: account('claude'), deps: rec.deps }));
    expect(error.code).toBe('http');
    expect(error.message).toContain('500');
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

  it('classifies rollout windows by window_minutes', async () => {
    await writeRollout({
      day: '2026-11-12',
      name: 'rollout-go.jsonl',
      lines: [
        tokenCount({
          primary: { used_percent: 14, window_minutes: 43_200, resets_at: 1_795_637_480 },
          secondary: null,
        }),
      ],
      mtime: new Date('2026-11-12T11:00:00Z'),
    });
    const snapshot = await readUsage({ account: account('codex'), deps: recorder({}).deps });
    expect(snapshot.windows).toEqual([
      { kind: 'monthly', usedPercent: 14, resetsAt: '2026-11-25T20:11:20.000Z' },
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

describe('readUsage codex api', () => {
  const CODEX_TOKEN = 'codex-secret-access-token';

  beforeEach(async () => {
    await writeFile(
      join(homeDir, 'auth.json'),
      JSON.stringify({ tokens: { access_token: CODEX_TOKEN, account_id: 'acc-1' } }),
    );
  });

  it('reads every rate limit from the ChatGPT usage endpoint', async () => {
    const body = {
      rate_limit: {
        primary_window: { used_percent: 20, limit_window_seconds: 18_000, reset_after_seconds: 60 },
        secondary_window: {
          used_percent: 40,
          limit_window_seconds: 604_800,
          reset_at: 1_794_484_800,
        },
      },
      code_review_rate_limit: null,
      additional_rate_limits: [
        {
          limit_name: 'GPT-5-Codex-Spark',
          rate_limit: {
            primary_window: { used_percent: 75, limit_window_seconds: 18_000, reset_at: null },
            secondary_window: null,
          },
        },
      ],
    };
    const rec = recorder({ response: { ok: true, status: 200, body } });
    const snapshot = await readUsage({ account: account('codex'), deps: rec.deps });
    expect(rec.requests.map((r) => [r.url, r.init.headers])).toEqual([
      [
        'https://chatgpt.com/backend-api/wham/usage',
        { Authorization: `Bearer ${CODEX_TOKEN}`, 'ChatGPT-Account-Id': 'acc-1' },
      ],
    ]);
    expect(snapshot).toEqual({
      provider: 'codex',
      source: 'api',
      fetchedAt: NOW.toISOString(),
      windows: [
        { kind: 'session', usedPercent: 20, resetsAt: '2026-11-12T12:01:00.000Z' },
        { kind: 'weekly', usedPercent: 40, resetsAt: '2026-11-12T12:00:00.000Z' },
        { kind: 'session', usedPercent: 75, resetsAt: null, scope: 'GPT-5-Codex-Spark' },
      ],
    });
  });

  it('classifies a 30-day primary window as monthly', async () => {
    const body = {
      rate_limit: {
        primary_window: { used_percent: 14, limit_window_seconds: 2_592_000, reset_at: null },
        secondary_window: null,
      },
    };
    const rec = recorder({ response: { ok: true, status: 200, body } });
    const snapshot = await readUsage({ account: account('codex'), deps: rec.deps });
    expect(snapshot.windows).toEqual([{ kind: 'monthly', usedPercent: 14, resetsAt: null }]);
  });

  it('falls back to rollout files when the endpoint fails', async () => {
    await writeRollout({
      day: '2026-11-12',
      name: 'rollout-a.jsonl',
      lines: [tokenCount({ primary: { used_percent: 5 }, secondary: null })],
      mtime: new Date('2026-11-12T11:00:00Z'),
    });
    const rec = recorder({ response: { ok: false, status: 401, body: {} } });
    const snapshot = await readUsage({ account: account('codex'), deps: rec.deps });
    expect(snapshot).toMatchObject({
      source: 'rollout',
      windows: [{ kind: 'session', usedPercent: 5, resetsAt: null }],
    });
  });

  it('falls back to rollout files when fetch rejects', async () => {
    const rec = recorder({});
    rec.deps.fetch = () => Promise.reject(new TypeError('fetch failed'));
    const snapshot = await readUsage({ account: account('codex'), deps: rec.deps });
    expect(snapshot.source).toBe('unavailable');
  });
});

describe('readUsage gemini', () => {
  async function markGeminiLoggedIn(): Promise<void> {
    const dir = join(homeDir, '.gemini', 'antigravity-cli');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'antigravity-oauth-token'), '{"token":{}}');
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
    expect(rec.envs[0]?.['HOME']).toBe(homeDir);
    expect(rec.envs[0]?.['SSH_CONNECTION']).toBe('127.0.0.1 0 127.0.0.1 0');
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

  it('reads every agy group and scopes the non-primary ones by name', async () => {
    await markGeminiLoggedIn();
    const groups = [
      {
        name: 'Claude and GPT models',
        buckets: [
          { id: '3p-weekly', window: 'weekly', remaining_fraction: 0.5, reset_time: null },
          { id: '3p-5h', window: '5h', remaining_fraction: 1, reset_time: null },
        ],
      },
      {
        name: 'Gemini Models',
        buckets: [{ id: 'gemini-5h', window: '5h', remaining_fraction: 0.9, reset_time: null }],
      },
      {
        name: 'Gemini 4 Argon',
        buckets: [
          {
            id: 'gemini-argon-wtu-weekly',
            window: 'weekly',
            remaining_fraction: 0,
            reset_time: '2026-11-14T01:10:40Z',
          },
        ],
      },
    ];
    const stdout = JSON.stringify({ status: 'SUCCESS', command: { data: { groups } } });
    const rec = recorder({ platform: 'darwin', runResult: { exitCode: 0, stdout } });
    const snapshot = await readUsage({ account: account('gemini'), deps: rec.deps });
    expect(snapshot.windows).toEqual([
      { kind: 'session', usedPercent: 0, resetsAt: null, scope: 'Claude and GPT models' },
      { kind: 'weekly', usedPercent: 50, resetsAt: null, scope: 'Claude and GPT models' },
      { kind: 'session', usedPercent: 10, resetsAt: null },
      {
        kind: 'weekly',
        usedPercent: 100,
        resetsAt: '2026-11-14T01:10:40.000Z',
        scope: 'Gemini 4 Argon',
      },
    ]);
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

describe('exhaustion helpers', () => {
  const snapshot = (source: UsageSnapshot['source'], percents: number[]): UsageSnapshot => ({
    provider: 'claude',
    source,
    fetchedAt: NOW.toISOString(),
    windows: percents.map((usedPercent) => ({ kind: 'session', usedPercent, resetsAt: null })),
  });
  const past = '2026-11-12T11:00:00.000Z';
  const future = '2026-11-12T13:00:00.000Z';

  it('picks the latest resetsAt among exhausted windows', () => {
    expect(
      exhaustionResetAt([
        { kind: 'session', usedPercent: 100, resetsAt: past },
        { kind: 'weekly', usedPercent: 100, resetsAt: future },
        { kind: 'weekly', usedPercent: 50, resetsAt: '2027-01-01T00:00:00.000Z' },
      ]),
    ).toBe(future);
    expect(exhaustionResetAt([{ kind: 'session', usedPercent: 100, resetsAt: null }])).toBeNull();
    expect(exhaustionResetAt([])).toBeNull();
  });

  it('trusts fresh api data over the stored reset', () => {
    expect(exhaustionVerdict({ resetsAt: future, now: NOW, fresh: snapshot('api', [40]) })).toBe(
      'available',
    );
    expect(exhaustionVerdict({ resetsAt: past, now: NOW, fresh: snapshot('api', [100]) })).toBe(
      'exhausted',
    );
  });

  it('ignores fresh windows whose reset already passed', () => {
    const stale: UsageSnapshot = {
      provider: 'codex',
      source: 'rollout',
      fetchedAt: NOW.toISOString(),
      windows: [{ kind: 'session', usedPercent: 100, resetsAt: past }],
    };
    expect(exhaustionVerdict({ resetsAt: past, now: NOW, fresh: stale })).toBe('available');
  });

  it('falls back to the stored reset without useful fresh data', () => {
    const none = snapshot('unavailable', []);
    expect(exhaustionVerdict({ resetsAt: past, now: NOW, fresh: none })).toBe('available');
    expect(exhaustionVerdict({ resetsAt: future, now: NOW, fresh: none })).toBe('exhausted');
    expect(exhaustionVerdict({ resetsAt: null, now: NOW, fresh: null })).toBe('available');
    expect(exhaustionVerdict({ resetsAt: future, now: NOW, fresh: null })).toBe('exhausted');
  });
});
