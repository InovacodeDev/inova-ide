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
  'Token da conta vencido. O consumo volta a atualizar no próximo uso da conta.';

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

async function setup(input: { tokenExpiresAt: number }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'inova-claude-usage-edge-')));
  tmpDirs.push(root);
  const clock = { ms: START_MS };
  const run = vi.fn<CommandRunner['run']>(async () => ({ notFound: true }));
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
      claudeAiOauth: { accessToken: 'secret-token', expiresAt: input.tokenExpiresAt },
    }),
  );
  return { clock, fetch, handlers };
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

test('an expired token skips the request and does not mark the account expired', async () => {
  const { fetch, handlers } = await setup({ tokenExpiresAt: START_MS - 1 });
  expect(await handlers.getUsage({ accountLabel: 'pessoal' })).toEqual({
    ok: false,
    message: TOKEN_EXPIRED_MESSAGE,
  });
  expect(fetch).not.toHaveBeenCalled();
  const accounts = unwrapOk(await handlers.listAccounts());
  expect(accounts.find((account) => account.label === 'pessoal')?.status).not.toBe('expired');
});

function unwrapOk<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
