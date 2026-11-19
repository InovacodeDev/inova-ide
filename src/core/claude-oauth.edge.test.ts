import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_OAUTH_CLIENT_ID,
  CLAUDE_OAUTH_TOKEN_URL,
  claudeKeychainService,
  refreshClaudeCredentials,
} from './claude-oauth.js';
import type { CommandRunner } from './providers.js';
import type { Account } from './types.js';
import { UsageError, UsageRateLimitError, readUsage } from './usage.js';
import type { UsageDeps } from './usage.js';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const EXPIRED = NOW.getTime() - 1;
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

let root: string;
let homeDir: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'inova-claude-oauth-edge-')));
  homeDir = join(root, 'account');
  await mkdir(homeDir);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

type FetchInit = Parameters<UsageDeps['fetch']>[1];
type FetchResult = Awaited<ReturnType<UsageDeps['fetch']>>;
type RunCommand = Parameters<CommandRunner['run']>[0];

function jsonResponse(
  status: number,
  body: unknown,
  retryAfter: string | null = null,
): FetchResult {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
    json: async () => body,
  };
}

const TOKEN_OK = {
  access_token: 'new-access',
  refresh_token: 'new-refresh',
  expires_in: 28_800,
  refresh_token_expires_in: 2_592_000,
  scope: 'user:inference user:profile',
};

const USAGE_OK = { five_hour: { utilization: 12, resets_at: null } };

function harness(options: {
  platform?: NodeJS.Platform;
  token?: FetchResult;
  usage?: FetchResult;
  run?: (cmd: RunCommand) => Awaited<ReturnType<CommandRunner['run']>>;
}) {
  const calls: { url: string; init: FetchInit }[] = [];
  const commands: RunCommand[] = [];
  const deps: UsageDeps = {
    platform: options.platform ?? 'linux',
    now: () => NOW,
    runner: {
      run: async (cmd) => {
        commands.push(cmd);
        return options.run ? options.run(cmd) : { notFound: true };
      },
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url === CLAUDE_OAUTH_TOKEN_URL) return options.token ?? jsonResponse(200, TOKEN_OK);
      return options.usage ?? jsonResponse(200, USAGE_OK);
    },
  };
  return { deps, calls, commands };
}

function account(): Account {
  return { id: 'c1', provider: 'claude', label: 'pessoal', homeDir, createdAt: NOW.toISOString() };
}

function credentialsDocument(oauth: Record<string, unknown>): Record<string, unknown> {
  return {
    mcpOAuth: { keep: true },
    claudeAiOauth: {
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: EXPIRED,
      scopes: ['user:inference', 'user:profile'],
      subscriptionType: 'team',
      rateLimitTier: 'default_raven',
      ...oauth,
    },
  };
}

async function writeCredentials(oauth: Record<string, unknown> = {}): Promise<void> {
  await writeFile(join(homeDir, '.credentials.json'), JSON.stringify(credentialsDocument(oauth)));
}

async function readCredentials(): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(join(homeDir, '.credentials.json'), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error('bad credentials');
  return parsed as Record<string, unknown>;
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function captureError(promise: Promise<unknown>): Promise<UsageError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof UsageError)) throw new Error('expected a UsageError');
  return error;
}

describe('readUsage refreshes an expired Claude token', () => {
  it('posts the refresh grant, saves the rotated token and reads usage with it', async () => {
    await writeCredentials();
    const { deps, calls } = harness({});
    const snapshot = await readUsage({ account: account(), deps });

    expect(snapshot.windows).toEqual([{ kind: 'session', usedPercent: 12, resetsAt: null }]);
    expect(calls.map((call) => call.url)).toEqual([CLAUDE_OAUTH_TOKEN_URL, USAGE_URL]);
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init.body ?? '')).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh',
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      scope: 'user:inference user:profile',
    });
    expect(calls[1]?.init.headers['Authorization']).toBe('Bearer new-access');

    expect(await readCredentials()).toEqual({
      mcpOAuth: { keep: true },
      claudeAiOauth: {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: NOW.getTime() + 28_800_000,
        refreshTokenExpiresAt: NOW.getTime() + 2_592_000_000,
        scopes: ['user:inference', 'user:profile'],
        subscriptionType: 'team',
        rateLimitTier: 'default_raven',
      },
    });
    expect(await pathExists(join(homeDir, '.oauth_refresh.lock'))).toBe(false);
    expect(await pathExists(`${homeDir}.lock`)).toBe(false);
  });

  it('keeps the old refresh token when the response does not rotate it', async () => {
    await writeCredentials({ clientId: 'custom-client' });
    const { access_token, expires_in } = TOKEN_OK;
    const { deps, calls } = harness({ token: jsonResponse(200, { access_token, expires_in }) });
    await readUsage({ account: account(), deps });
    expect(JSON.parse(calls[0]?.init.body ?? '')).toMatchObject({ client_id: 'custom-client' });
    const oauth = (await readCredentials())['claudeAiOauth'];
    expect(oauth).toMatchObject({ accessToken: 'new-access', refreshToken: 'old-refresh' });
  });

  it('maps a rejected refresh grant to unauthorized and leaves credentials untouched', async () => {
    await writeCredentials();
    const before = await readCredentials();
    const { deps, calls } = harness({
      token: jsonResponse(400, { error: 'invalid_grant', error_description: 'old-refresh' }),
    });
    const error = await captureError(readUsage({ account: account(), deps }));
    expect(error.code).toBe('unauthorized');
    expect(error.message).not.toContain('old-refresh');
    expect(calls.map((call) => call.url)).toEqual([CLAUDE_OAUTH_TOKEN_URL]);
    expect(await readCredentials()).toEqual(before);
  });

  it('maps a 429 from the token endpoint to a rate-limit error with Retry-After', async () => {
    await writeCredentials();
    const { deps } = harness({ token: jsonResponse(429, {}, '30') });
    const error = await captureError(readUsage({ account: account(), deps }));
    expect(error).toBeInstanceOf(UsageRateLimitError);
    expect(error instanceof UsageRateLimitError ? error.retryAfterMs : null).toBe(30_000);
  });

  it('reports a transient failure when the token endpoint errors or sends a bad body', async () => {
    for (const token of [jsonResponse(500, {}), jsonResponse(200, { access_token: 'x' })]) {
      await writeCredentials();
      const { deps } = harness({ token });
      const error = await captureError(readUsage({ account: account(), deps }));
      expect(error.code).toBe('token-expired');
      expect((await readCredentials())['claudeAiOauth']).toMatchObject({
        accessToken: 'old-access',
      });
    }
  });

  it('reports a transient failure when the network request rejects', async () => {
    await writeCredentials();
    const { deps } = harness({});
    deps.fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const error = await captureError(readUsage({ account: account(), deps }));
    expect(error.code).toBe('token-expired');
    expect(await pathExists(join(homeDir, '.oauth_refresh.lock'))).toBe(false);
  });
});

describe('refreshClaudeCredentials lock', () => {
  it('does not refresh while another process holds a fresh lock', async () => {
    await writeCredentials();
    const lock = join(homeDir, '.oauth_refresh.lock');
    await mkdir(lock);
    await utimes(lock, NOW, NOW);
    const { deps, calls } = harness({});
    expect(await refreshClaudeCredentials(deps, homeDir)).toEqual({ kind: 'busy' });
    expect(calls).toEqual([]);
    expect(await pathExists(lock)).toBe(true);
  });

  it('does not refresh while the legacy lock is held and releases the primary lock', async () => {
    await writeCredentials();
    await mkdir(`${homeDir}.lock`);
    await utimes(`${homeDir}.lock`, NOW, NOW);
    const { deps, calls } = harness({});
    expect(await refreshClaudeCredentials(deps, homeDir)).toEqual({ kind: 'busy' });
    expect(calls).toEqual([]);
    expect(await pathExists(join(homeDir, '.oauth_refresh.lock'))).toBe(false);
  });

  it('takes over a stale lock older than 60 seconds', async () => {
    await writeCredentials();
    const lock = join(homeDir, '.oauth_refresh.lock');
    await mkdir(lock);
    const old = new Date(NOW.getTime() - 61_000);
    await utimes(lock, old, old);
    const { deps } = harness({});
    const outcome = await refreshClaudeCredentials(deps, homeDir);
    expect(outcome.kind).toBe('refreshed');
    expect(await pathExists(lock)).toBe(false);
  });

  it('skips the request when the token is no longer expired after taking the lock', async () => {
    await writeCredentials({ expiresAt: NOW.getTime() + 60_000 });
    const { deps, calls } = harness({});
    const outcome = await refreshClaudeCredentials(deps, homeDir);
    expect(outcome).toMatchObject({ kind: 'refreshed', oauth: { accessToken: 'old-access' } });
    expect(calls).toEqual([]);
  });
});

describe('refreshClaudeCredentials keychain', () => {
  const service = (): string => claudeKeychainService(homeDir);

  interface KeychainOptions {
    writeExit?: number;
    persistWrites?: boolean;
    attributes?: string;
  }

  function keychainRunner(document: Record<string, unknown>, options: KeychainOptions = {}) {
    let stored = JSON.stringify(document);
    return (cmd: RunCommand): Awaited<ReturnType<CommandRunner['run']>> => {
      if (cmd.args[0] === '-i') {
        const hex = /-X "([0-9a-f]+)"/.exec(cmd.input ?? '')?.[1] ?? '';
        if ((options.persistWrites ?? true) && (options.writeExit ?? 0) === 0) {
          stored = Buffer.from(hex, 'hex').toString('utf8');
        }
        return { exitCode: options.writeExit ?? 0, stdout: '' };
      }
      if (cmd.args.includes('-w')) return { exitCode: 0, stdout: `${stored}\n` };
      return {
        exitCode: 0,
        stdout:
          options.attributes ??
          `keychain: "/x/login.keychain-db"\n    "acct"<blob>="someone"\n    "svce"<blob>="${service()}"\n`,
      };
    };
  }

  it('writes the rotated document through security -i stdin as hex, never in argv', async () => {
    const { deps, commands } = harness({
      platform: 'darwin',
      run: keychainRunner(credentialsDocument({})),
    });
    const outcome = await refreshClaudeCredentials(deps, homeDir);
    expect(outcome.kind).toBe('refreshed');

    const write = commands.find((cmd) => cmd.args[0] === '-i');
    expect(write?.command).toBe('security');
    expect(write?.args).toEqual(['-i']);
    const line = write?.input ?? '';
    // REGEX: splits `add-generic-password -U -a "<acct>" -s "<service>" -X "<hex>"` into its parts
    const match = /^add-generic-password -U -a "([^"]+)" -s "([^"]+)" -X "([0-9a-f]+)"\n$/.exec(
      line,
    );
    expect(match?.[1]).toBe('someone');
    expect(match?.[2]).toBe(service());
    const saved: unknown = JSON.parse(Buffer.from(match?.[3] ?? '', 'hex').toString('utf8'));
    expect(saved).toMatchObject({
      mcpOAuth: { keep: true },
      claudeAiOauth: { accessToken: 'new-access', refreshToken: 'new-refresh' },
    });
    for (const cmd of commands) expect(cmd.args.join(' ')).not.toContain('new-access');
  });

  it('retries once and reports save-failed when the keychain write fails', async () => {
    const { deps, commands } = harness({
      platform: 'darwin',
      run: keychainRunner(credentialsDocument({}), { writeExit: 1 }),
    });
    const outcome = await refreshClaudeCredentials(deps, homeDir);
    expect(outcome).toEqual({ kind: 'save-failed' });
    expect(commands.filter((cmd) => cmd.args[0] === '-i')).toHaveLength(2);
  });

  it('reports save-failed when security exits 0 but the item did not change', async () => {
    const { deps } = harness({
      platform: 'darwin',
      run: keychainRunner(credentialsDocument({}), { persistWrites: false }),
    });
    expect(await refreshClaudeCredentials(deps, homeDir)).toEqual({ kind: 'save-failed' });
  });

  it('does not call the token endpoint when the keychain account cannot be read', async () => {
    const { deps, calls } = harness({
      platform: 'darwin',
      run: keychainRunner(credentialsDocument({}), { attributes: 'keychain: "/x"\n' }),
    });
    const outcome = await refreshClaudeCredentials(deps, homeDir);
    expect(outcome.kind).toBe('failed');
    expect(calls).toEqual([]);
  });
});

describe('refreshClaudeCredentials races', () => {
  it('returns the token another process saved when our refresh grant is rejected', async () => {
    await writeCredentials();
    const { deps } = harness({});
    deps.fetch = async () => {
      await writeFile(
        join(homeDir, '.credentials.json'),
        JSON.stringify(
          credentialsDocument({
            accessToken: 'cli-access',
            refreshToken: 'cli-refresh',
            expiresAt: NOW.getTime() + 3_600_000,
          }),
        ),
      );
      return jsonResponse(400, { error: 'invalid_grant' });
    };
    const outcome = await refreshClaudeCredentials(deps, homeDir);
    expect(outcome).toMatchObject({ kind: 'refreshed', oauth: { accessToken: 'cli-access' } });
  });

  it('uses the real path of the account dir for the legacy lock', async () => {
    await writeCredentials();
    const link = join(root, 'linked-account');
    await symlink(homeDir, link);
    await mkdir(`${homeDir}.lock`);
    await utimes(`${homeDir}.lock`, NOW, NOW);
    const { deps, calls } = harness({});
    expect(await refreshClaudeCredentials(deps, link)).toEqual({ kind: 'busy' });
    expect(calls).toEqual([]);
  });
});
