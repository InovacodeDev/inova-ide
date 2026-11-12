import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
  platform: NodeJS.Platform;
  runResult?: RunResult;
  response?: { ok: boolean; status: number; body: unknown };
}): Recorder {
  const commands: Recorder['commands'] = [];
  const requests: Recorder['requests'] = [];
  const response = options.response ?? { ok: true, status: 200, body: {} };
  const deps: UsageDeps = {
    platform: options.platform,
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
