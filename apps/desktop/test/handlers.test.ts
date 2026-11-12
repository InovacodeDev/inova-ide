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

test('openProject rejects NaN size gracefully', async () => {
  const { root, open, handlers } = await setup();
  const { project } = await seedProject(root);
  unwrap(await handlers.openProject({ projectId: project.id, cols: Number.NaN, rows: 24 }));
  expect(open.mock.calls[0]?.[0].cols).toBeNaN();
  const bad = await handlers.openProject({ projectId: project.id, cols: '80', rows: 24 });
  expect(bad).toEqual(INVALID);
  expect(open).toHaveBeenCalledTimes(1);
});

test('openProject reports an unknown project', async () => {
  const { handlers, open } = await setup();
  const result = await handlers.openProject({ projectId: 'nope', cols: 80, rows: 24 });
  expect(result).toEqual({ ok: false, message: 'Projeto não encontrado.' });
  expect(open).not.toHaveBeenCalled();
});

test('openLogin runs the login args in the account home', async () => {
  const { root, open, handlers } = await setup();
  const { account } = await seedProject(root);
  const result = await handlers.openLogin({ accountLabel: 'pessoal', cols: 80, rows: 24 });
  expect(unwrap(result).title).toBe('login · pessoal');
  const spec = open.mock.calls[0]?.[0].spec;
  expect(spec).toMatchObject({ args: ['auth', 'login'], cwd: account.homeDir });
  const missing = await handlers.openLogin({ accountLabel: 'x', cols: 80, rows: 24 });
  expect(missing).toEqual({ ok: false, message: 'Account not found: x' });
});

test('removeAccount refuses while a session of the account is open', async () => {
  const { root, inUse, handlers } = await setup();
  const { account } = await seedProject(root);
  inUse.add(account.id);
  const result = await handlers.removeAccount({ label: 'pessoal', force: true });
  expect(result).toEqual({ ok: false, message: 'Feche as abas desta conta antes de removê-la.' });
  expect((await loadStore(root)).accounts).toHaveLength(1);
  inUse.clear();
  expect(unwrap(await handlers.removeAccount({ label: 'pessoal', force: true }))).toBeNull();
  expect((await loadStore(root)).accounts).toEqual([]);
});

test('bindProject maps PathNotFoundError to a message', async () => {
  const { root, handlers } = await setup();
  await addAccount({ root, provider: 'claude', label: 'pessoal' });
  const missing = join(root, 'nope');
  const result = await handlers.bindProject({ path: missing, accountLabel: 'pessoal' });
  expect(result).toEqual({ ok: false, message: `Caminho não encontrado: ${missing}` });
});

test('bindProject and unbindProject reject relative paths', async () => {
  const { root, handlers } = await setup();
  await addAccount({ root, provider: 'claude', label: 'pessoal' });
  expect(await handlers.bindProject({ path: 'rel/dir', accountLabel: 'pessoal' })).toEqual(INVALID);
  expect(await handlers.unbindProject({ path: 'rel/dir' })).toEqual(INVALID);
  expect((await loadStore(root)).projects).toEqual([]);
});

test('bindProject accepts a 300+ character absolute path and fails on realpath', async () => {
  const { root, handlers } = await setup();
  await addAccount({ root, provider: 'claude', label: 'pessoal' });
  const long = join(root, ...Array.from({ length: 4 }, () => 'd'.repeat(90)));
  expect(long.length).toBeGreaterThan(300);
  const result = await handlers.bindProject({ path: long, accountLabel: 'pessoal' });
  expect(result).toEqual({ ok: false, message: `Caminho não encontrado: ${long}` });
});
