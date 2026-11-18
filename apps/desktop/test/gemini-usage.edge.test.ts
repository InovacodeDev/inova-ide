import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { addAccount } from '@inova/core/accounts';
import { PROVIDER_MODELS } from '@inova/core/models';
import type { CommandRunner } from '@inova/core/providers';
import type { UsageDeps } from '@inova/core/usage';
import { createHandlers } from '../src/main/handlers.js';
import type { ChatRunner } from '../src/main/chat.js';
import type { SessionManager } from '../src/main/sessions.js';
import { SESSION_EXPIRED_USAGE_MESSAGE } from '../src/shared/api.js';
import { localizeModelOption } from '../src/renderer/model-picker-state.js';

const tmpDirs: string[] = [];
const createdHandlers: ReturnType<typeof createHandlers>[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-gemini-usage-edge-')));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(createdHandlers.splice(0).map((handlers) => handlers.flushPendingWrites()));
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setupWithEnv(input: { baseEnv: NodeJS.ProcessEnv; runImpl: CommandRunner['run'] }) {
  const root = await makeTempDir();
  const run = vi.fn<CommandRunner['run']>(input.runImpl);
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
    usageDeps: {
      platform: 'darwin',
      runner: { run },
      fetch,
      now: () => new Date('2026-11-18T12:00:00.000Z'),
    },
    emit: vi.fn(),
    baseEnv: async () => input.baseEnv,
    pickFolder: async () => null,
    pickAttachments: async () => [],
  });
  createdHandlers.push(handlers);
  const account = await addAccount({ root, provider: 'gemini', label: 'google-pessoal' });
  const tokenDir = join(account.homeDir, '.gemini', 'antigravity-cli');
  await mkdir(tokenDir, { recursive: true });
  await writeFile(join(tokenDir, 'antigravity-oauth-token'), '{"token":{}}');
  return { root, account, run, handlers };
}

test('getUsage resolves agy from baseEnv PATH and Path (Windows casing)', async () => {
  const payload = JSON.stringify({
    status: 'SUCCESS',
    command: {
      data: {
        groups: [
          {
            name: 'Gemini Models',
            buckets: [{ id: 'gemini-5h', window: '5h', remaining_fraction: 0.7, reset_time: null }],
          },
          {
            name: 'Gemini 4 Argon',
            buckets: [
              {
                id: 'gemini-argon-wtu-weekly',
                window: 'weekly',
                remaining_fraction: 0.2,
                reset_time: '2026-11-25T03:00:00Z',
              },
            ],
          },
        ],
      },
    },
  });

  for (const envKey of ['PATH', 'Path'] as const) {
    const bin = await makeTempDir();
    const agyPath = join(bin, 'agy');
    await writeFile(agyPath, '#!/bin/sh\nexit 0\n');
    await chmod(agyPath, 0o755);

    const { account, run, handlers } = await setupWithEnv({
      baseEnv: { [envKey]: bin },
      runImpl: async () => ({ exitCode: 0, stdout: payload }),
    });

    const result = await handlers.getUsage({ accountLabel: 'google-pessoal' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.value).toEqual({
      provider: 'gemini',
      source: 'api',
      fetchedAt: '2026-11-18T12:00:00.000Z',
      windows: [
        { kind: 'session', usedPercent: 30, resetsAt: null },
        {
          kind: 'weekly',
          usedPercent: 80,
          resetsAt: '2026-11-25T03:00:00.000Z',
          scope: 'Gemini 4 Argon',
        },
      ],
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: agyPath,
        args: ['-p', '/usage', '--output-format', 'json'],
        cwd: account.homeDir,
        timeoutMs: 30_000,
      }),
    );
  }
});

test('getUsage returns unavailable when agy binary is not present in baseEnv PATH', async () => {
  const emptyBin = await makeTempDir();
  const { run, handlers } = await setupWithEnv({
    baseEnv: { PATH: emptyBin },
    runImpl: async () => ({ exitCode: 0, stdout: '{}' }),
  });

  const result = await handlers.getUsage({ accountLabel: 'google-pessoal' });
  expect(run).not.toHaveBeenCalled();
  expect(result).toEqual({
    ok: true,
    value: {
      provider: 'gemini',
      windows: [],
      source: 'unavailable',
      fetchedAt: '2026-11-18T12:00:00.000Z',
    },
  });
});

test('getUsage marks gemini account expired when agy reports logged-out session', async () => {
  const bin = await makeTempDir();
  const agyPath = join(bin, 'agy');
  await writeFile(agyPath, '#!/bin/sh\nexit 0\n');
  await chmod(agyPath, 0o755);

  const { handlers } = await setupWithEnv({
    baseEnv: { PATH: bin },
    runImpl: async () => ({
      exitCode: 1,
      stdout: 'Error: You are not logged into Antigravity.',
    }),
  });

  const usageResult = await handlers.getUsage({ accountLabel: 'google-pessoal' });
  expect(usageResult).toEqual({ ok: false, message: SESSION_EXPIRED_USAGE_MESSAGE });

  const accounts = await handlers.listAccounts();
  expect(accounts.ok).toBe(true);
  if (!accounts.ok) throw new Error(accounts.message);
  expect(accounts.value.find((a) => a.label === 'google-pessoal')?.status).toBe('expired');
});

test('every model in PROVIDER_MODELS with a description has an English localization', () => {
  for (const catalog of Object.values(PROVIDER_MODELS)) {
    for (const model of catalog.models) {
      if (!model.description) continue;
      const localized = localizeModelOption(
        { id: model.id, label: model.label, description: '__pt-sentinel__' },
        'en-US',
      );
      expect(localized.description, `Missing en-US description for ${model.id}`).not.toBe(
        '__pt-sentinel__',
      );
      expect(localized.description?.trim().length).toBeGreaterThan(0);
    }
  }
});
