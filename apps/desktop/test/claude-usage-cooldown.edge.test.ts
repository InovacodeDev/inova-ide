import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { addAccount } from '@inova/core/accounts';
import type { CommandRunner } from '@inova/core/providers';
import type { UsageDeps } from '@inova/core/usage';
import { createHandlers } from '../src/main/handlers.js';
import type { ChatRunner } from '../src/main/chat.js';
import type { SessionManager } from '../src/main/sessions.js';

const START_MS = Date.parse('2026-11-18T12:00:00.000Z');
const RATE_LIMITED_MESSAGE =
  'Limite de consultas de consumo atingido. O app tenta de novo em alguns minutos.';
const TOKEN_EXPIRED_MESSAGE =
  'Não foi possível renovar o token da conta. O app tenta de novo na próxima atualização.';
const SESSION_EXPIRED_MESSAGE = 'Sessão da conta expirou. Renove o login em Contas.';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';

const tmpDirs: string[] = [];
const createdHandlers: ReturnType<typeof createHandlers>[] = [];

afterEach(async () => {
  await Promise.all(createdHandlers.splice(0).map((handlers) => handlers.flushPendingWrites()));
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type FetchResult = Awaited<ReturnType<UsageDeps['fetch']>>;

function rateLimited(retryAfter: string | null): FetchResult {
  return {
    ok: false,
    status: 429,
    headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
    json: async () => ({}),
  };
}

function usageOk(percent: number): FetchResult {
  return {
    ok: true,
    status: 200,
    json: async () => ({ five_hour: { utilization: percent, resets_at: null } }),
  };
}

async function setup(input: { tokenExpiresAt: number; refreshToken?: string }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'inova-claude-usage-edge-')));
  tmpDirs.push(root);
  const clock = { ms: START_MS };
  const run = vi.fn<CommandRunner['run']>(async (cmd) =>
    cmd.args.join(' ') === 'auth status --json'
      ? { exitCode: 0, stdout: '{"loggedIn":true}' }
      : { notFound: true },
  );
  const sessions: SessionManager = {
    open: vi.fn(() => 'sess-1'),
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    closeAll: vi.fn(async () => undefined),
    accountsInUse: () => new Set(),
  };
  const chat: ChatRunner = {
    send: vi.fn(),
    cancel: vi.fn(),
    isRunning: () => false,
    accountsInUse: () => new Set(),
    closeAll: vi.fn(async () => undefined),
  };
  const fetch = vi.fn<UsageDeps['fetch']>();
  const handlers = createHandlers({
    root,
    runner: { run },
    sessions,
    chat,
    usageDeps: { platform: 'linux', runner: { run }, fetch, now: () => new Date(clock.ms) },
    emit: vi.fn(),
    baseEnv: async () => ({ PATH: '/usr/bin' }),
    pickFolder: async () => null,
    pickAttachments: async () => [],
  });
  createdHandlers.push(handlers);
  const account = await addAccount({ root, provider: 'claude', label: 'pessoal' });
  await writeFile(
    join(account.homeDir, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: 'secret-token',
        expiresAt: input.tokenExpiresAt,
        ...(input.refreshToken === undefined ? {} : { refreshToken: input.refreshToken }),
      },
    }),
  );
  return { clock, fetch, handlers, homeDir: account.homeDir };
}

const VALID_FOR_A_DAY = START_MS + 86_400_000;

test('a 429 pauses Claude usage requests until Retry-After elapses', async () => {
  const { clock, fetch, handlers } = await setup({ tokenExpiresAt: VALID_FOR_A_DAY });
  fetch.mockResolvedValue(rateLimited('120'));
  expect(await handlers.getUsage({ accountLabel: 'pessoal' })).toEqual({
    ok: false,
    message: RATE_LIMITED_MESSAGE,
  });
  expect(fetch).toHaveBeenCalledTimes(1);

  clock.ms += 60_000;
  expect(await handlers.getUsage({ accountLabel: 'pessoal' })).toEqual({
    ok: false,
    message: RATE_LIMITED_MESSAGE,
  });
  expect(fetch).toHaveBeenCalledTimes(1);

  clock.ms += 60_000;
  fetch.mockResolvedValue(usageOk(33));
  const result = await handlers.getUsage({ accountLabel: 'pessoal' });
  expect(result).toMatchObject({ ok: true, value: { windows: [{ usedPercent: 33 }] } });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('without Retry-After the pause doubles after each consecutive 429 and resets on success', async () => {
  const { clock, fetch, handlers } = await setup({ tokenExpiresAt: VALID_FOR_A_DAY });
  fetch.mockResolvedValue(rateLimited(null));
  await handlers.getUsage({ accountLabel: 'pessoal' });
  expect(fetch).toHaveBeenCalledTimes(1);

  clock.ms += 120_000;
  await handlers.getUsage({ accountLabel: 'pessoal' });
  expect(fetch).toHaveBeenCalledTimes(2);

  clock.ms += 120_000;
  await handlers.getUsage({ accountLabel: 'pessoal' });
  expect(fetch).toHaveBeenCalledTimes(2);

  clock.ms += 120_000;
  fetch.mockResolvedValue(usageOk(10));
  unwrapOk(await handlers.getUsage({ accountLabel: 'pessoal' }));
  expect(fetch).toHaveBeenCalledTimes(3);

  fetch.mockResolvedValue(rateLimited(null));
  await handlers.getUsage({ accountLabel: 'pessoal' });
  clock.ms += 120_000;
  await handlers.getUsage({ accountLabel: 'pessoal' });
  expect(fetch).toHaveBeenCalledTimes(5);
});

test('keeps serving the last good snapshot while paused', async () => {
  const { clock, fetch, handlers } = await setup({ tokenExpiresAt: VALID_FOR_A_DAY });
  fetch.mockResolvedValue(usageOk(42));
  const first = unwrapOk(await handlers.getUsage({ accountLabel: 'pessoal' }));

  clock.ms += 60_000;
  fetch.mockResolvedValue(rateLimited('600'));
  expect(unwrapOk(await handlers.getUsage({ accountLabel: 'pessoal' }))).toEqual(first);

  clock.ms += 60_000;
  expect(unwrapOk(await handlers.getUsage({ accountLabel: 'pessoal' }))).toEqual(first);
  expect(fetch).toHaveBeenCalledTimes(2);
});

function tokenResponse(status: number, body: unknown): FetchResult {
  return { ok: status === 200, status, json: async () => body };
}

async function statusOf(handlers: Awaited<ReturnType<typeof setup>>['handlers']) {
  const accounts = unwrapOk(await handlers.listAccounts());
  return accounts.find((account) => account.label === 'pessoal')?.status;
}

test('an expired token is refreshed and usage is read with the new token', async () => {
  const { fetch, handlers } = await setup({ tokenExpiresAt: START_MS - 1, refreshToken: 'rt' });
  fetch.mockImplementation(async (url) =>
    url === TOKEN_URL
      ? tokenResponse(200, { access_token: 'fresh', refresh_token: 'rt2', expires_in: 3600 })
      : usageOk(21),
  );
  const result = await handlers.getUsage({ accountLabel: 'pessoal' });
  expect(result).toMatchObject({ ok: true, value: { windows: [{ usedPercent: 21 }] } });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    TOKEN_URL,
    'https://api.anthropic.com/api/oauth/usage',
  ]);
  expect(fetch.mock.calls[1]?.[1].headers['Authorization']).toBe('Bearer fresh');
});

test('a transient refresh failure keeps the account logged in', async () => {
  const { fetch, handlers } = await setup({ tokenExpiresAt: START_MS - 1, refreshToken: 'rt' });
  fetch.mockResolvedValue(tokenResponse(503, {}));
  expect(await handlers.getUsage({ accountLabel: 'pessoal' })).toEqual({
    ok: false,
    message: TOKEN_EXPIRED_MESSAGE,
  });
  expect(await statusOf(handlers)).toBe('logged-in');
});

test('a rejected refresh token marks the account expired', async () => {
  const { fetch, handlers } = await setup({ tokenExpiresAt: START_MS - 1, refreshToken: 'rt' });
  fetch.mockResolvedValue(tokenResponse(400, { error: 'invalid_grant' }));
  expect(await handlers.getUsage({ accountLabel: 'pessoal' })).toEqual({
    ok: false,
    message: SESSION_EXPIRED_MESSAGE,
  });
  expect(await statusOf(handlers)).toBe('expired');
});

function unwrapOk<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
