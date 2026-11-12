import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { addAccount } from '@inova/core/accounts';
import { bindProject } from '@inova/core/projects';
import type { CommandRunner } from '@inova/core/providers';
import { loadStore } from '@inova/core/store';
import { createHandlers } from '../src/main/handlers.js';
import type { SessionManager } from '../src/main/sessions.js';
import type { Result } from '../src/shared/api.js';

const INVALID = { ok: false, message: 'Entrada inválida.' };
const tmpDirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-handlers-')));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

async function setup(options: { withBinary?: boolean } = {}) {
  const root = await tmp();
  const bin = await tmp();
  if (options.withBinary ?? true) {
    await writeFile(join(bin, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  const inUse = new Set<string>();
  const run = vi.fn<CommandRunner['run']>(async () => ({
    exitCode: 0,
    stdout: '{"loggedIn":true}',
  }));
  const open = vi.fn<SessionManager['open']>(() => 'sess-1');
  const sessions: SessionManager = {
    open,
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    closeAll: vi.fn(),
    accountsInUse: () => inUse,
  };
  const baseEnv = { PATH: bin, TERM: 'xterm-256color', ANTHROPIC_API_KEY: 'fake-key' };
  const handlers = createHandlers({
    root,
    runner: { run },
    sessions,
    baseEnv: async () => baseEnv,
    pickFolder: async () => '/picked',
  });
  return { root, bin, run, open, inUse, handlers };
}

async function seedProject(root: string) {
  const account = await addAccount({ root, provider: 'claude', label: 'pessoal' });
  const project = await bindProject({ root, path: await tmp(), accountLabel: 'pessoal' });
  return { account, project };
}

test('addAccount rejects unknown provider and empty label without touching the store', async () => {
  const { root, handlers } = await setup();
  for (const input of [{ provider: 'x', label: 'a' }, { provider: 'claude', label: '' }, null]) {
    expect(await handlers.addAccount(input)).toEqual(INVALID);
  }
  expect((await loadStore(root)).accounts).toEqual([]);
});

test('addAccount creates the account and reports its status', async () => {
  const { handlers } = await setup();
  const view = unwrap(await handlers.addAccount({ provider: 'claude', label: 'pessoal' }));
  expect(view).toMatchObject({ label: 'pessoal', provider: 'claude', status: 'logged-in' });
});

test('listAccounts reports status with api keys stripped', async () => {
  const { root, run, handlers } = await setup();
  const { account } = await seedProject(root);
  const views = unwrap(await handlers.listAccounts());
  expect(views).toEqual([
    { id: account.id, label: 'pessoal', provider: 'claude', status: 'logged-in' },
  ]);
  const env = run.mock.calls[0]?.[0].env;
  expect(env?.['ANTHROPIC_API_KEY']).toBeUndefined();
  expect(env?.['CLAUDE_CONFIG_DIR']).toBe(account.homeDir);
});

test('openProject spawns absolute binary in project dir with account isolation', async () => {
  const { root, bin, open, handlers } = await setup();
  const { account, project } = await seedProject(root);
  const result = await handlers.openProject({ projectId: project.id, cols: 100, rows: 30 });
  expect(unwrap(result)).toEqual({
    sessionId: 'sess-1',
    title: `${basename(project.path)} · pessoal`,
  });
  const call = open.mock.calls[0]?.[0];
  expect(call).toMatchObject({ file: join(bin, 'claude'), accountId: account.id, cols: 100 });
  expect(call?.spec.cwd).toBe(project.path);
  expect(call?.spec.env['CLAUDE_CONFIG_DIR']).toBe(account.homeDir);
  expect(call?.spec.env['TERM']).toBe('xterm-256color');
  expect(call?.spec.env['ANTHROPIC_API_KEY']).toBeUndefined();
});

test('openProject marks claude onboarding before launch', async () => {
  const { root, handlers } = await setup();
  const { account, project } = await seedProject(root);
  const file = join(account.homeDir, '.claude.json');
  await writeFile(file, '{}');
  unwrap(await handlers.openProject({ projectId: project.id, cols: 80, rows: 24 }));
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ hasCompletedOnboarding: true });
});

test('openProject reports missing binary with install hint', async () => {
  const { root, open, handlers } = await setup({ withBinary: false });
  const { project } = await seedProject(root);
  const result = await handlers.openProject({ projectId: project.id, cols: 80, rows: 24 });
  expect(result.ok).toBe(false);
  expect(!result.ok && result.message).toContain('pnpm add -g @anthropic-ai/claude-code');
  expect(open).not.toHaveBeenCalled();
});

test('openProject forwards NaN size but rejects non-number size', async () => {
  const { root, open, handlers } = await setup();
  const { project } = await seedProject(root);
  unwrap(await handlers.openProject({ projectId: project.id, cols: Number.NaN, rows: 24 }));
  expect(open.mock.calls[0]?.[0].cols).toBeNaN();
  const bad = await handlers.openProject({ projectId: project.id, cols: '80', rows: 24 });
  expect(bad).toEqual(INVALID);
  expect(open).toHaveBeenCalledTimes(1);
});
