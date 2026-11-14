import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, test, vi } from 'vitest';
import { addAccount } from '@inova/core/accounts';
import type { ChatEvent } from '@inova/core/chat-types';
import { createCheckpoint } from '@inova/core/git-checkpoints';
import { bindProject } from '@inova/core/projects';
import type { CommandRunner } from '@inova/core/providers';
import { claudeProjectDirName } from '@inova/core/session-import';
import { createSession, updateSession } from '@inova/core/sessions';
import { loadStore } from '@inova/core/store';
import type { Store } from '@inova/core/types';
import type { UsageDeps } from '@inova/core/usage';
import type { ChatRunner } from '../src/main/chat.js';
import { createHandlers, isExternalWebUrl } from '../src/main/handlers.js';
import type { HandlerDeps } from '../src/main/handlers.js';
import type { SessionManager } from '../src/main/sessions.js';
import type { LoginEvent, Result } from '../src/shared/api.js';

const INVALID = { ok: false, message: 'Entrada inválida.' };
const tmpDirs: string[] = [];
const createdHandlers: ReturnType<typeof createHandlers>[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-handlers-')));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(createdHandlers.splice(0).map((handlers) => handlers.flushPendingWrites()));
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

async function setup(
  options: { withBinary?: boolean; home?: string; withOpenPath?: boolean } = {},
) {
  const root = await tmp();
  const bin = await tmp();
  if (options.withBinary ?? true) {
    await writeFile(join(bin, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await writeFile(join(bin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await writeFile(join(bin, 'agy'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  const inUse = new Set<string>();
  const running = new Set<string>();
  const chatInUse = new Set<string>();
  const clock = { iso: '2026-01-01T00:00:00.000Z' };
  const idleListeners: ((accountId: string) => void)[] = [];
  const pausedSnapshots: string[][] = [];
  const emitted: { sessionId: string; event: ChatEvent }[] = [];
  const loginEvents: LoginEvent[] = [];
  const send = vi.fn<ChatRunner['send']>();
  const cancel = vi.fn<ChatRunner['cancel']>();
  const chat: ChatRunner = {
    send,
    cancel,
    isRunning: (sessionId) => running.has(sessionId),
    accountsInUse: () => chatInUse,
    onAccountIdle: (listener) => {
      idleListeners.push(listener);
      return () => undefined;
    },
    closeAll: vi.fn(),
  };
  const fetch = vi.fn<UsageDeps['fetch']>();
  const run = vi.fn<CommandRunner['run']>(async () => ({
    exitCode: 0,
    stdout: '{"loggedIn":true}',
  }));
  const open = vi.fn<SessionManager['open']>(() => 'sess-1');
  const writePty = vi.fn<SessionManager['write']>();
  const closePty = vi.fn<SessionManager['close']>();
  const sessions: SessionManager = {
    open,
    write: writePty,
    resize: vi.fn(),
    close: closePty,
    closeAll: vi.fn(),
    accountsInUse: () => inUse,
  };
  const baseEnv = {
    PATH: bin,
    TERM: 'xterm-256color',
    ANTHROPIC_API_KEY: 'fake-key',
    ...(options.home === undefined ? {} : { HOME: options.home }),
  };
  const notify = vi.fn<NonNullable<HandlerDeps['notify']>>(async () => ({
    ok: true,
    value: null,
  }));
  const openPath = vi.fn<NonNullable<HandlerDeps['openPath']>>(async () => undefined);
  const handlers = createHandlers({
    root,
    notify,
    ...(options.withOpenPath === false ? {} : { openPath }),
    runner: { run },
    sessions,
    chat,
    usageDeps: {
      platform: 'linux',
      runner: { run },
      fetch,
      now: () => new Date(clock.iso),
    },
    emit: (sessionId, event) => emitted.push({ sessionId, event }),
    emitLogin: (event) => loginEvents.push(event),
    emitQueuePaused: (sessionIds) => pausedSnapshots.push(sessionIds),
    baseEnv: async () => baseEnv,
    pickFolder: async () => '/picked',
    pickAttachments: async (kind) => [{ path: `/picked/${kind}`, isDirectory: kind === 'any' }],
  });
  createdHandlers.push(handlers);
  return {
    root,
    bin,
    run,
    open,
    writePty,
    closePty,
    inUse,
    running,
    chatInUse,
    clock,
    idleListeners,
    pausedSnapshots,
    emitted,
    loginEvents,
    send,
    cancel,
    fetch,
    notify,
    openPath,
    handlers,
  };
}

async function seedSession(root: string) {
  const { account, project } = await seedProject(root);
  const session = await createSession({ root, projectId: project.id });
  return { account, project, session };
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

test('pickAttachments forwards a valid kind and rejects an unknown one', async () => {
  const { handlers } = await setup();
  expect(unwrap(await handlers.pickAttachments({ kind: 'images' }))).toEqual([
    { path: '/picked/images', isDirectory: false },
  ]);
  expect(await handlers.pickAttachments({ kind: 'videos' })).toEqual({
    ok: false,
    message: 'Entrada inválida.',
  });
});

test('addAccount creates the account and reports its status', async () => {
  const { handlers } = await setup();
  const view = unwrap(await handlers.addAccount({ provider: 'claude', label: 'pessoal' }));
  expect(view).toMatchObject({ label: 'pessoal', provider: 'claude', status: 'logged-in' });
});

test('addAccount keeps the saved account and reports unknown status when the check throws', async () => {
  const { root, run, handlers } = await setup();
  run.mockRejectedValueOnce(new Error('spawn failed'));
  const view = unwrap(await handlers.addAccount({ provider: 'claude', label: 'pessoal' }));
  expect(view).toMatchObject({ label: 'pessoal', status: 'unknown' });
  expect((await loadStore(root)).accounts).toHaveLength(1);
});

test('listAccounts reports status and connected email with api keys stripped', async () => {
  const { root, run, handlers } = await setup();
  const { account, project } = await seedProject(root);
  await writeFile(
    join(account.homeDir, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'dev@inova.test' } }),
  );
  const views = unwrap(await handlers.listAccounts());
  expect(views).toEqual([
    {
      id: account.id,
      label: 'pessoal',
      email: 'dev@inova.test',
      provider: 'claude',
      status: 'logged-in',
    },
  ]);
  expect(unwrap(await handlers.listProjects())).toEqual([
    {
      id: project.id,
      path: project.path,
      accountLabel: 'pessoal',
      accountEmail: 'dev@inova.test',
      provider: 'claude',
    },
  ]);
  const env = run.mock.calls[0]?.[0].env;
  expect(env?.['ANTHROPIC_API_KEY']).toBeUndefined();
  expect(env?.['CLAUDE_CONFIG_DIR']).toBe(account.homeDir);
});

test('listAccounts reports unknown for an account whose check throws and keeps the others', async () => {
  const { root, run, handlers } = await setup();
  const broken = await addAccount({ root, provider: 'claude', label: 'quebrada' });
  const healthy = await addAccount({ root, provider: 'claude', label: 'saudavel' });
  run.mockImplementation(async ({ env }) => {
    if (env['CLAUDE_CONFIG_DIR'] === broken.homeDir) throw new Error('spawn failed');
    return { exitCode: 0, stdout: '{"loggedIn":true}' };
  });
  expect(unwrap(await handlers.listAccounts())).toEqual([
    { id: broken.id, label: 'quebrada', email: null, provider: 'claude', status: 'unknown' },
    { id: healthy.id, label: 'saudavel', email: null, provider: 'claude', status: 'logged-in' },
  ]);
});

test('sendMessage reports a missing binary with install hint and does not spawn', async () => {
  const { root, send, handlers } = await setup({ withBinary: false });
  const { session } = await seedSession(root);
  const result = await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' });
  expect(result.ok).toBe(false);
  expect(!result.ok && result.message).toContain('pnpm add -g @anthropic-ai/claude-code');
  expect(send).not.toHaveBeenCalled();
});

test('sendMessage rejects invalid input and unknown sessions', async () => {
  const { send, handlers } = await setup();
  expect(await handlers.sendMessage({ sessionId: '../x', prompt: 'oi' })).toEqual(INVALID);
  expect(await handlers.sendMessage({ sessionId: 's', prompt: '  ' })).toEqual(INVALID);
  expect(await handlers.sendMessage({ sessionId: 'ghost', prompt: 'oi' })).toEqual({
    ok: false,
    message: 'Sessão não encontrada.',
  });
  expect(send).not.toHaveBeenCalled();
});

test('sendMessage grants the approved extra directories to the claude turn', async () => {
  const { root, send, handlers } = await setup();
  const { session } = await seedSession(root);
  unwrap(
    await handlers.sendMessage({
      sessionId: session.id,
      prompt: '@/Users/me/Downloads/doc.pdf resuma',
      extraDirs: ['/Users/me/Downloads'],
    }),
  );
  const args = send.mock.calls[0]?.[0]?.spec.args ?? [];
  const flag = args.indexOf('--add-dir');
  expect(args[flag + 1]).toBe('/Users/me/Downloads');
  expect(flag).toBeGreaterThan(-1);
  expect(flag).toBeLessThan(args.indexOf('--'));
});

test('a new claude turn persists the session id before spawning and derives the title', async () => {
  const { root, bin, send, handlers } = await setup();
  const { account, project, session } = await seedSession(root);
  const prompt = `${'a'.repeat(70)}\nsegunda linha`;
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt }));
  const call = send.mock.calls[0]?.[0];
  expect(call).toMatchObject({
    sessionId: session.id,
    accountId: account.id,
    provider: 'claude',
    file: join(bin, 'claude'),
  });
  expect(call?.spec.cwd).toBe(project.path);
  expect(call?.spec.env['CLAUDE_CONFIG_DIR']).toBe(account.homeDir);
  expect(call?.spec.env['ANTHROPIC_API_KEY']).toBeUndefined();
  const flag = call?.spec.args.indexOf('--session-id') ?? -1;
  const uuid = call?.spec.args[flag + 1];
  expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
  const stored = (await loadStore(root)).sessions?.[0];
  expect(stored?.providerSessionId).toBe(uuid);
  expect(stored?.title).toBe('a'.repeat(60));
});

test('isExternalWebUrl accepts only http and https urls', () => {
  expect(isExternalWebUrl('https://example.com/a?b=1')).toBe(true);
  expect(isExternalWebUrl('http://example.com')).toBe(true);
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ftp://example.com',
    'data:text/html,x',
    'not a url',
    '',
  ]) {
    expect(isExternalWebUrl(url)).toBe(false);
  }
});

const failedDone: ChatEvent = { kind: 'done', isError: true, costUsd: null, durationMs: null };

async function providerSessionOf(root: string): Promise<string | null | undefined> {
  return (await loadStore(root)).sessions?.[0]?.providerSessionId;
}

test('a failed first turn without a session event clears the provisional provider session', async () => {
  const { root, handlers } = await setup();
  const { session } = await seedSession(root);
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' }));
  expect(await providerSessionOf(root)).not.toBeNull();
  handlers.handleChatEvent(session.id, failedDone);
  await vi.waitFor(async () => {
    expect(await providerSessionOf(root)).toBeNull();
  });
});

test('a failed first turn keeps the provider session once the CLI confirmed it', async () => {
  const { root, handlers } = await setup();
  const { session } = await seedSession(root);
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' }));
  const provisional = await providerSessionOf(root);
  handlers.handleChatEvent(session.id, { kind: 'session', providerSessionId: 'confirmed' });
  handlers.handleChatEvent(session.id, failedDone);
  await handlers.loadTranscript({ sessionId: session.id });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(await providerSessionOf(root)).toBe(provisional);
});

test('a failed resumed turn keeps the existing provider session', async () => {
  const { root, handlers } = await setup();
  const { session } = await seedSession(root);
  await updateSession({
    root,
    sessionId: session.id,
    patch: { providerSessionId: 'existing' },
  });
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' }));
  handlers.handleChatEvent(session.id, failedDone);
  await handlers.loadTranscript({ sessionId: session.id });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(await providerSessionOf(root)).toBe('existing');
});

test('a later turn starts a new session after the provisional id was cleared', async () => {
  const { root, send, handlers } = await setup();
  const { session } = await seedSession(root);
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' }));
  handlers.handleChatEvent(session.id, failedDone);
  await vi.waitFor(async () => {
    expect(await providerSessionOf(root)).toBeNull();
  });
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'de novo' }));
  const args = send.mock.calls[1]?.[0].spec.args ?? [];
  expect(args).toContain('--session-id');
  expect(args).not.toContain('--resume');
});

test('sendMessage persists the session before the process is spawned', async () => {
  const { root, send, handlers } = await setup();
  const { session } = await seedSession(root);
  let storeAtSpawn: Promise<Store> | undefined;
  send.mockImplementation(() => {
    storeAtSpawn = loadStore(root);
  });
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' }));
  expect((await storeAtSpawn)?.sessions?.[0]?.providerSessionId).toMatch(/^[0-9a-f-]{36}$/);
});

test('a custom title is kept and a session with an id resumes', async () => {
  const { root, send, handlers } = await setup();
  const { session } = await seedSession(root);
  await updateSession({
    root,
    sessionId: session.id,
    patch: { title: 'Meu título', providerSessionId: 'prov-1' },
  });
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'continue' }));
  const args = send.mock.calls[0]?.[0].spec.args;
  expect(args).toContain('--resume');
  expect(args).toContain('prov-1');
  expect(args).not.toContain('--session-id');
  const stored = (await loadStore(root)).sessions?.[0];
  expect(stored).toMatchObject({ title: 'Meu título', providerSessionId: 'prov-1' });
});

test('a claude child session forks from the parent provider session', async () => {
  const { root, send, handlers } = await setup();
  const { project, session: parent } = await seedSession(root);
  await updateSession({ root, sessionId: parent.id, patch: { providerSessionId: 'parent-prov' } });
  const child = await createSession({ root, projectId: project.id, parentId: parent.id });
  unwrap(await handlers.sendMessage({ sessionId: child.id, prompt: 'ramifique' }));
  const args = send.mock.calls[0]?.[0].spec.args ?? [];
  expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 3)).toEqual([
    '--resume',
    'parent-prov',
    '--fork-session',
  ]);
  const stored = (await loadStore(root)).sessions?.find((item) => item.id === child.id);
  expect(stored?.providerSessionId).toBe(args[args.indexOf('--session-id') + 1]);
  expect(stored?.title).toBe('ramifique');
});

test('a child of a parent without provider session starts a new turn', async () => {
  const { root, send, handlers } = await setup();
  const { project, session: parent } = await seedSession(root);
  const child = await createSession({ root, projectId: project.id, parentId: parent.id });
  unwrap(await handlers.sendMessage({ sessionId: child.id, prompt: 'x' }));
  const args = send.mock.calls[0]?.[0].spec.args ?? [];
  expect(args).not.toContain('--fork-session');
  expect(args).toContain('--session-id');
});

test('a codex turn stores the provider session only when the session event arrives', async () => {
  const { root, send, handlers } = await setup();
  const account = await addAccount({ root, provider: 'codex', label: 'cx' });
  const project = await bindProject({ root, path: await tmp(), accountLabel: 'cx' });
  const session = await createSession({ root, projectId: project.id });
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' }));
  const call = send.mock.calls[0]?.[0];
  expect(call).toMatchObject({ provider: 'codex', accountId: account.id });
  expect(call?.spec.args[0]).toBe('exec');
  expect((await loadStore(root)).sessions?.[0]?.providerSessionId).toBeNull();
  handlers.handleChatEvent(session.id, { kind: 'session', providerSessionId: 'thread-9' });
  await vi.waitFor(async () => {
    expect((await loadStore(root)).sessions?.[0]?.providerSessionId).toBe('thread-9');
  });
  handlers.handleChatEvent(session.id, { kind: 'session', providerSessionId: 'other' });
  await handlers.loadTranscript({ sessionId: session.id });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect((await loadStore(root)).sessions?.[0]?.providerSessionId).toBe('thread-9');
});

test('a gemini turn stores the provider session only when the session event arrives', async () => {
  const { root, send, handlers } = await setup();
  const account = await addAccount({ root, provider: 'gemini', label: 'gm' });
  const project = await bindProject({ root, path: await tmp(), accountLabel: 'gm' });
  const session = await createSession({ root, projectId: project.id });
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' }));
  const call = send.mock.calls[0]?.[0];
  expect(call).toMatchObject({ provider: 'gemini', accountId: account.id });
  expect(call?.spec.command).toBe('agy');
  expect(call?.spec.args).not.toContain('--session-id');
  expect((await loadStore(root)).sessions?.[0]?.providerSessionId).toBeNull();
  handlers.handleChatEvent(session.id, { kind: 'session', providerSessionId: 'conv-42' });
  await vi.waitFor(async () => {
    expect((await loadStore(root)).sessions?.[0]?.providerSessionId).toBe('conv-42');
  });
});

test('sendMessage refuses while a turn is running', async () => {
  const { root, running, send, handlers } = await setup();
  const { session } = await seedSession(root);
  running.add(session.id);
  expect(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' })).toEqual({
    ok: false,
    message: 'Já existe um turno em andamento nesta sessão.',
  });
  expect(send).not.toHaveBeenCalled();
  expect((await loadStore(root)).sessions?.[0]?.providerSessionId).toBeNull();
});

test('sendMessage marks claude onboarding before launch', async () => {
  const { root, handlers } = await setup();
  const { account, session } = await seedSession(root);
  const file = join(account.homeDir, '.claude.json');
  await writeFile(file, '{}');
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' }));
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ hasCompletedOnboarding: true });
});

test('sendMessage emits and stores the user message before spawning', async () => {
  const { root, emitted, send, handlers } = await setup();
  const { session } = await seedSession(root);
  send.mockImplementation(() => {
    expect(emitted).toHaveLength(1);
  });
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: '  oi  ' }));
  expect(emitted[0]).toMatchObject({ sessionId: session.id, event: { kind: 'user', text: 'oi' } });
  const transcript = unwrap(await handlers.loadTranscript({ sessionId: session.id }));
  expect(transcript).toEqual([expect.objectContaining({ kind: 'user', text: 'oi' })]);
});

test('transcript keeps event order, skips deltas and invalid lines', async () => {
  const { root, emitted, handlers } = await setup();
  const { session } = await seedSession(root);
  const events: ChatEvent[] = [
    { kind: 'user', text: 'oi', at: 't' },
    { kind: 'text-delta', blockId: 'b', text: 'o' },
    { kind: 'text', blockId: 'b', text: 'olá' },
    { kind: 'tool-use', toolId: 't1', name: 'Read', input: '{}' },
    { kind: 'tool-result', toolId: 't1', output: 'x', isError: false },
    { kind: 'done', isError: false, costUsd: 0.1, durationMs: 5 },
  ];
  for (const event of events) handlers.handleChatEvent(session.id, event);
  expect(emitted.map((item) => item.event)).toEqual(events);
  const file = join(root, 'sessions', `${session.id}.jsonl`);
  await handlers.loadTranscript({ sessionId: session.id });
  await writeFile(file, `garbage\n{"kind":"nope"}\n${await readFile(file, 'utf8')}`);
  const loaded = unwrap(await handlers.loadTranscript({ sessionId: session.id }));
  expect(loaded).toEqual(events.filter((event) => event.kind !== 'text-delta'));
});

test('loadTranscript returns an empty list when no transcript exists', async () => {
  const { root, handlers } = await setup();
  const { session } = await seedSession(root);
  expect(unwrap(await handlers.loadTranscript({ sessionId: session.id }))).toEqual([]);
  expect(await handlers.loadTranscript({ sessionId: '../x' })).toEqual(INVALID);
});

test('session crud maps session errors to Portuguese', async () => {
  const { root, handlers } = await setup();
  const { project, session } = await seedSession(root);
  expect(unwrap(await handlers.listSessions({ projectId: project.id }))).toEqual([session]);
  const child = unwrap(
    await handlers.createSession({ projectId: project.id, parentId: session.id }),
  );
  expect(child).toMatchObject({ parentId: session.id, title: 'Subsessão' });
  const renamed = unwrap(await handlers.updateSession({ sessionId: child.id, title: '  Novo ' }));
  expect(renamed.title).toBe('Novo');
  expect(await handlers.createSession({ projectId: 'nope' })).toEqual({
    ok: false,
    message: 'Projeto não encontrado.',
  });
  expect(await handlers.createSession({ projectId: project.id, parentId: 'nope' })).toEqual({
    ok: false,
    message: 'Sessão pai não encontrada.',
  });
  expect(await handlers.updateSession({ sessionId: 'ghost', title: 'x' })).toEqual({
    ok: false,
    message: 'Sessão não encontrada.',
  });
  expect(await handlers.updateSession({ sessionId: child.id, title: 'a'.repeat(201) })).toEqual({
    ok: false,
    message: 'O título deve ter de 1 a 200 caracteres.',
  });
  expect(await handlers.updateSession({ sessionId: child.id })).toEqual(INVALID);
});

test('updateSession archives the subtree, keeps listing it and closes it in the workspace', async () => {
  const { root, handlers } = await setup();
  const { project, session } = await seedSession(root);
  const child = await createSession({ root, projectId: project.id, parentId: session.id });
  const other = await createSession({ root, projectId: project.id });
  unwrap(
    await handlers.saveWorkspace({
      openSessionIds: [session.id, child.id, other.id],
      activeSessionId: child.id,
    }),
  );
  const archived = unwrap(await handlers.updateSession({ sessionId: session.id, archived: true }));
  expect(archived.archivedAt).not.toBeNull();
  const listed = unwrap(await handlers.listSessions({ projectId: project.id }));
  expect(listed.map((item) => [item.id, item.archivedAt !== null])).toEqual([
    [session.id, true],
    [child.id, true],
    [other.id, false],
  ]);
  expect(unwrap(await handlers.getWorkspace())).toEqual({
    openSessionIds: [other.id],
    activeSessionId: null,
  });
  const restored = unwrap(await handlers.updateSession({ sessionId: session.id, archived: false }));
  expect(restored.archivedAt).toBeNull();
});

test('updateSession refuses to archive while the session or a descendant is running', async () => {
  const { root, running, handlers } = await setup();
  const { project, session } = await seedSession(root);
  const child = await createSession({ root, projectId: project.id, parentId: session.id });
  running.add(child.id);
  expect(await handlers.updateSession({ sessionId: session.id, archived: true })).toEqual({
    ok: false,
    message: 'Pare o turno em andamento antes de arquivar.',
  });
  expect((await loadStore(root)).sessions?.every((item) => item.archivedAt === null)).toBe(true);
  expect(unwrap(await handlers.updateSession({ sessionId: session.id, title: 'Ok' })).title).toBe(
    'Ok',
  );
});

test('sendMessage refuses an archived session', async () => {
  const { root, send, handlers } = await setup();
  const { session } = await seedSession(root);
  unwrap(await handlers.updateSession({ sessionId: session.id, archived: true }));
  expect(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' })).toEqual({
    ok: false,
    message: 'Desarquive a sessão antes de enviar mensagens.',
  });
  expect(send).not.toHaveBeenCalled();
});

test('workspace round trips, validates input and survives session deletion', async () => {
  const { root, handlers } = await setup();
  const { project, session } = await seedSession(root);
  const other = await createSession({ root, projectId: project.id });
  expect(unwrap(await handlers.getWorkspace())).toEqual({
    openSessionIds: [],
    activeSessionId: null,
  });
  expect(await handlers.saveWorkspace({ openSessionIds: ['a/b'], activeSessionId: null })).toEqual(
    INVALID,
  );
  const workspace = { openSessionIds: [session.id, other.id], activeSessionId: other.id };
  expect(unwrap(await handlers.saveWorkspace(workspace))).toBeNull();
  expect(unwrap(await handlers.getWorkspace())).toEqual(workspace);
  unwrap(await handlers.deleteSession({ sessionId: other.id }));
  expect(unwrap(await handlers.getWorkspace())).toEqual({
    openSessionIds: [session.id],
    activeSessionId: null,
  });
});

test('deleteSession removes the subtree and its transcripts', async () => {
  const { root, handlers } = await setup();
  const { project, session } = await seedSession(root);
  const child = await createSession({ root, projectId: project.id, parentId: session.id });
  const other = await createSession({ root, projectId: project.id });
  for (const item of [session, child, other]) {
    handlers.handleChatEvent(item.id, { kind: 'user', text: 'oi', at: 't' });
    await handlers.loadTranscript({ sessionId: item.id });
  }
  expect(unwrap(await handlers.deleteSession({ sessionId: session.id }))).toBeNull();
  expect((await loadStore(root)).sessions?.map((item) => item.id)).toEqual([other.id]);
  const files = await readdir(join(root, 'sessions'));
  expect(files).toEqual([`${other.id}.jsonl`]);
  expect(await handlers.deleteSession({ sessionId: session.id })).toEqual({
    ok: false,
    message: 'Sessão não encontrada.',
  });
});

test('deleteSession refuses when the session or a descendant is running', async () => {
  const { root, running, handlers } = await setup();
  const { project, session } = await seedSession(root);
  const child = await createSession({ root, projectId: project.id, parentId: session.id });
  running.add(child.id);
  expect(await handlers.deleteSession({ sessionId: session.id })).toEqual({
    ok: false,
    message: 'Pare o turno em andamento antes de apagar.',
  });
  expect((await loadStore(root)).sessions).toHaveLength(2);
});

test('cancelTurn forwards to the runner', async () => {
  const { cancel, handlers } = await setup();
  handlers.cancelTurn('s1');
  expect(cancel).toHaveBeenCalledWith('s1');
});

test('getUsage returns the api snapshot', async () => {
  const { root, fetch, handlers } = await setup();
  const { account } = await seedSession(root);
  await writeFile(
    join(account.homeDir, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'secret-token' } }),
  );
  fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ five_hour: { utilization: 42, resets_at: null } }),
  });
  const snapshot = unwrap(await handlers.getUsage({ accountLabel: 'pessoal' }));
  expect(snapshot).toMatchObject({
    source: 'api',
    windows: [{ kind: 'session', usedPercent: 42 }],
  });
});

test('getUsage reports errors in Portuguese without leaking the token', async () => {
  const { root, fetch, handlers } = await setup();
  const { account } = await seedSession(root);
  expect(await handlers.getUsage({ accountLabel: 'pessoal' })).toEqual({
    ok: false,
    message: 'Não foi possível ler o consumo: credenciais não encontradas.',
  });
  await writeFile(
    join(account.homeDir, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'secret-token' } }),
  );
  fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
  expect(await handlers.getUsage({ accountLabel: 'pessoal' })).toEqual({
    ok: false,
    message: 'Não foi possível ler o consumo (HTTP 429).',
  });
  fetch.mockRejectedValue(new Error('network secret-token'));
  const network = await handlers.getUsage({ accountLabel: 'pessoal' });
  expect(network).toEqual({ ok: false, message: 'Não foi possível ler o consumo.' });
  expect(await handlers.getUsage({ accountLabel: 'ghost' })).toEqual({
    ok: false,
    message: 'Conta não encontrada: ghost.',
  });
});

async function exhaustAccount(input: { resetsAt: string | null }) {
  const ctx = await setup();
  const { account, session } = await seedSession(ctx.root);
  await writeFile(
    join(account.homeDir, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'secret-token' } }),
  );
  unwrap(await ctx.handlers.sendMessage({ sessionId: session.id, prompt: 'oi' }));
  ctx.handlers.handleChatEvent(session.id, {
    kind: 'usage-limits',
    windows: [{ kind: 'session', usedPercent: 100, resetsAt: input.resetsAt }],
  });
  ctx.handlers.handleChatEvent(session.id, { kind: 'error', message: '429 rate_limit_exceeded' });
  ctx.handlers.handleChatEvent(session.id, {
    kind: 'done',
    isError: true,
    costUsd: null,
    durationMs: 1,
  });
  await ctx.handlers.listInbox();
  await ctx.handlers.loadTranscript({ sessionId: session.id });
  ctx.send.mockClear();
  return { ...ctx, session };
}

function localHm(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function apiUsage(utilization: number, resetsAt: string | null) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ five_hour: { utilization, resets_at: resetsAt } }),
  };
}

test('sendMessage blocks an exhausted account with a future reset without hitting the network', async () => {
  const { handlers, fetch, send, session } = await exhaustAccount({
    resetsAt: '2026-01-01T05:00:00.000Z',
  });
  const result = await handlers.sendMessage({ sessionId: session.id, prompt: 'de novo' });
  expect(result).toMatchObject({ ok: false });
  expect(result.ok ? '' : result.message).toBe(
    `CONTA_ESGOTADA: A conta atingiu o limite de uso. Libera às ${localHm('2026-01-01T05:00:00.000Z')}. Troque de conta ou execute handoff.`,
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test('sendMessage proceeds when the reset passed and fresh usage is below the limit', async () => {
  const { handlers, fetch, send, session } = await exhaustAccount({
    resetsAt: '2025-12-31T23:00:00.000Z',
  });
  fetch.mockResolvedValue(apiUsage(10, '2026-01-01T05:00:00.000Z'));
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'de novo' }));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'outra' }));
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  await handlers.loadTranscript({ sessionId: session.id });
});

test('sendMessage still blocks when the reset passed but fresh usage is at the limit', async () => {
  const { handlers, fetch, send, session } = await exhaustAccount({
    resetsAt: '2025-12-31T23:00:00.000Z',
  });
  fetch.mockResolvedValue(apiUsage(100, '2026-01-01T07:00:00.000Z'));
  const result = await handlers.sendMessage({ sessionId: session.id, prompt: 'de novo' });
  expect(result.ok ? '' : result.message).toBe(
    `CONTA_ESGOTADA: A conta atingiu o limite de uso. Libera às ${localHm('2026-01-01T07:00:00.000Z')}. Troque de conta ou execute handoff.`,
  );
  expect(send).not.toHaveBeenCalled();
  fetch.mockClear();
  const again = await handlers.sendMessage({ sessionId: session.id, prompt: 'de novo' });
  expect(again.ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

test('getUsage clears the exhaustion when no window is at the limit', async () => {
  const { handlers, fetch, send, session } = await exhaustAccount({
    resetsAt: '2026-01-01T05:00:00.000Z',
  });
  fetch.mockResolvedValue(apiUsage(20, '2026-01-01T05:00:00.000Z'));
  unwrap(await handlers.getUsage({ accountLabel: 'pessoal' }));
  fetch.mockClear();
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'de novo' }));
  expect(fetch).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
  await handlers.loadTranscript({ sessionId: session.id });
});

async function accountStatus(
  handlers: Awaited<ReturnType<typeof setup>>['handlers'],
  label: string,
): Promise<string | undefined> {
  return unwrap(await handlers.listAccounts()).find((item) => item.label === label)?.status;
}

function endTurn(
  handlers: Awaited<ReturnType<typeof setup>>['handlers'],
  input: { sessionId: string; isError: boolean },
): void {
  handlers.handleChatEvent(input.sessionId, {
    kind: 'done',
    isError: input.isError,
    costUsd: null,
    durationMs: 1,
  });
}

test('a revoked login in a chat turn marks the account expired until a new login succeeds', async () => {
  const { root, handlers } = await setup();
  const { session } = await seedSession(root);
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' }));
  handlers.handleChatEvent(session.id, {
    kind: 'error',
    message:
      'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has been revoked."}}',
  });
  endTurn(handlers, { sessionId: session.id, isError: true });

  expect(await accountStatus(handlers, 'pessoal')).toBe('expired');
  const inbox = unwrap(await handlers.listInbox());
  expect(inbox.find((item) => item.sessionId === session.id)).toMatchObject({
    kind: 'failed',
    summary: 'Sessão da conta pessoal expirou. Renove o login em Contas.',
  });

  unwrap(await handlers.startLogin({ accountLabel: 'pessoal' }));
  await handlers.handlePtyExit('sess-1', 0);
  expect(await accountStatus(handlers, 'pessoal')).toBe('logged-in');
  await handlers.loadTranscript({ sessionId: session.id });
});

test('a successful chat turn clears the expired mark', async () => {
  const { root, handlers } = await setup();
  const { session } = await seedSession(root);
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' }));
  handlers.handleChatEvent(session.id, {
    kind: 'error',
    message: 'Invalid API key · Please run /login',
  });
  endTurn(handlers, { sessionId: session.id, isError: true });
  expect(await accountStatus(handlers, 'pessoal')).toBe('expired');

  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'de novo' }));
  endTurn(handlers, { sessionId: session.id, isError: false });
  expect(await accountStatus(handlers, 'pessoal')).toBe('logged-in');
  await handlers.loadTranscript({ sessionId: session.id });
});

test('getUsage marks the account expired when the API rejects a valid token and clears it after success', async () => {
  const { root, fetch, handlers } = await setup();
  const { account } = await seedSession(root);
  await writeFile(
    join(account.homeDir, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: { accessToken: 'secret-token', expiresAt: Date.now() + 3_600_000 },
    }),
  );
  fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
  expect(await handlers.getUsage({ accountLabel: 'pessoal' })).toEqual({
    ok: false,
    message: 'Sessão da conta expirou. Renove o login em Contas.',
  });
  expect(await accountStatus(handlers, 'pessoal')).toBe('expired');

  fetch.mockResolvedValue(apiUsage(10, null));
  unwrap(await handlers.getUsage({ accountLabel: 'pessoal' }));
  expect(await accountStatus(handlers, 'pessoal')).toBe('logged-in');
});

test('getUsage falls back to the cached stream snapshot for claude', async () => {
  const { root, fetch, handlers } = await setup();
  const { session } = await seedSession(root);
  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'oi' }));
  const windows = [{ kind: 'session' as const, usedPercent: 10, resetsAt: null }];
  handlers.handleChatEvent(session.id, { kind: 'usage-limits', windows });
  fetch.mockRejectedValue(new Error('offline'));
  expect(unwrap(await handlers.getUsage({ accountLabel: 'pessoal' }))).toEqual({
    provider: 'claude',
    windows,
    source: 'stream',
    fetchedAt: '2026-01-01T00:00:00.000Z',
  });
});

test('unbindProject refuses while a project session is running', async () => {
  const { root, running, handlers } = await setup();
  const { project, session } = await seedSession(root);
  running.add(session.id);
  expect(await handlers.unbindProject({ path: project.path })).toEqual({
    ok: false,
    message: 'Pare os turnos deste projeto antes de desvinculá-lo.',
  });
  expect((await loadStore(root)).projects).toHaveLength(1);
  running.clear();
  handlers.handleChatEvent(session.id, { kind: 'user', text: 'oi', at: 't' });
  expect(unwrap(await handlers.unbindProject({ path: project.path }))).toBeNull();
  expect((await loadStore(root)).projects).toEqual([]);
  expect(await readdir(join(root, 'sessions'))).toEqual([]);
});

test('startLogin runs headless pty login, submits code, verifies exit, and supports cancel', async () => {
  const { root, open, writePty, closePty, loginEvents, handlers } = await setup();
  const { account } = await seedProject(root);
  const result = await handlers.startLogin({ accountLabel: 'pessoal' });
  expect(unwrap(result)).toEqual({
    sessionId: 'sess-1',
    accountLabel: 'pessoal',
    provider: 'claude',
  });
  const spec = open.mock.calls[0]?.[0].spec;
  expect(spec).toMatchObject({ args: ['auth', 'login'], cwd: account.homeDir });
  expect(loginEvents[0]).toMatchObject({ sessionId: 'sess-1', stage: 'starting' });

  const submitted = await handlers.submitLoginCode({ sessionId: 'sess-1', code: 'auth-code' });
  expect(submitted).toEqual({ ok: true, value: null });
  expect(writePty).toHaveBeenCalledWith('sess-1', 'auth-code\r');

  await handlers.handlePtyExit('sess-1', 0);
  expect(loginEvents.map((item) => item.stage)).toContain('verifying');
  expect(loginEvents.at(-1)).toMatchObject({ sessionId: 'sess-1', stage: 'succeeded' });

  const missingCode = await handlers.submitLoginCode({ sessionId: 'sess-1', code: 'late' });
  expect(missingCode).toEqual({
    ok: false,
    message: 'Sessão de login não encontrada ou já encerrada.',
  });

  await handlers.startLogin({ accountLabel: 'pessoal' });
  handlers.cancelLogin('sess-1');
  expect(closePty).toHaveBeenCalledWith('sess-1');
  expect(loginEvents.at(-1)).toMatchObject({ sessionId: 'sess-1', stage: 'canceled' });

  const missing = await handlers.startLogin({ accountLabel: 'x' });
  expect(missing).toEqual({ ok: false, message: 'Conta não encontrada: x.' });
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

test('removeAccount refuses while a chat turn of the account is running', async () => {
  const { root, chatInUse, handlers } = await setup();
  const { account } = await seedProject(root);
  chatInUse.add(account.id);
  expect(await handlers.removeAccount({ label: 'pessoal', force: true })).toEqual({
    ok: false,
    message: 'Pare os turnos desta conta antes de removê-la.',
  });
  expect((await loadStore(root)).accounts).toHaveLength(1);
  chatInUse.clear();
  expect(unwrap(await handlers.removeAccount({ label: 'pessoal', force: true }))).toBeNull();
});

test('concurrent addAccount calls do not lose updates', async () => {
  const { root, handlers } = await setup();
  const labels = ['a', 'b', 'c', 'd', 'e', 'f'];
  const results = await Promise.all(
    labels.map((label) => handlers.addAccount({ provider: 'claude', label })),
  );
  for (const result of results) expect(result.ok).toBe(true);
  expect((await loadStore(root)).accounts.map((item) => item.label).sort()).toEqual(labels);
});

test('concurrent bind, unbind and account changes keep every update', async () => {
  const { root, handlers } = await setup();
  await addAccount({ root, provider: 'claude', label: 'pessoal' });
  const paths = await Promise.all([tmp(), tmp(), tmp(), tmp()]);
  await Promise.all([
    ...paths.map((path) => handlers.bindProject({ path, accountLabel: 'pessoal' })),
    handlers.addAccount({ provider: 'codex', label: 'extra' }),
  ]);
  const store = await loadStore(root);
  expect(store.projects).toHaveLength(4);
  expect(store.accounts).toHaveLength(2);
  const first = paths[0] ?? '';
  const results = await Promise.all([
    handlers.unbindProject({ path: first }),
    handlers.removeAccount({ label: 'extra', force: true }),
    handlers.addAccount({ provider: 'claude', label: 'novo' }),
  ]);
  for (const result of results) expect(result.ok).toBe(true);
  const after = await loadStore(root);
  expect(after.projects).toHaveLength(3);
  expect(after.accounts.map((item) => item.label).sort()).toEqual(['novo', 'pessoal']);
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

test('account errors are reported in Portuguese', async () => {
  const { root, handlers } = await setup();
  const { project } = await seedProject(root);
  const input = { provider: 'claude', label: 'pessoal' };
  expect(await handlers.addAccount(input)).toEqual({
    ok: false,
    message: 'Já existe uma conta com o rótulo "pessoal".',
  });
  expect(await handlers.removeAccount({ label: 'ghost', force: false })).toEqual({
    ok: false,
    message: 'Conta não encontrada: ghost.',
  });
  expect(await handlers.bindProject({ path: project.path, accountLabel: 'ghost' })).toEqual({
    ok: false,
    message: 'Conta não encontrada: ghost.',
  });
  expect(await handlers.removeAccount({ label: 'pessoal', force: false })).toEqual({
    ok: false,
    message: 'A conta tem projetos vinculados. Remova com force para desvinculá-los.',
  });
});

test('store and account path errors are reported in Portuguese', async () => {
  const { root, handlers } = await setup();
  const file = join(root, 'store.json');
  await writeFile(file, 'not json');
  expect(await handlers.listAccounts()).toEqual({
    ok: false,
    message: `Arquivo de dados corrompido: ${file}.`,
  });
  const account = { id: 'abc', provider: 'claude', label: 'x', homeDir: '/elsewhere' };
  const store = { version: 1, accounts: [{ ...account, createdAt: 't' }], projects: [] };
  await writeFile(file, JSON.stringify(store));
  expect(await handlers.removeAccount({ label: 'x', force: false })).toEqual({
    ok: false,
    message: 'Caminho da conta inválido; remoção recusada.',
  });
});

test('updateSession updates model and effort, validates provider effort, and passes flags on sendMessage', async () => {
  const { root, send, handlers } = await setup();
  const { session } = await seedSession(root);

  const rejected = await handlers.updateSession({ sessionId: session.id, effort: 'minimal' });
  expect(rejected).toEqual({
    ok: false,
    message: 'Nível de esforço não suportado por este provedor.',
  });

  const updated = unwrap(
    await handlers.updateSession({ sessionId: session.id, model: 'opus', effort: 'max' }),
  );
  expect(updated.model).toBe('opus');
  expect(updated.effort).toBe('max');

  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'olá' }));
  const args = send.mock.calls[0]?.[0]?.spec.args ?? [];
  expect(args).toContain('--model');
  expect(args[args.indexOf('--model') + 1]).toBe('opus');
  expect(args).toContain('--effort');
  expect(args[args.indexOf('--effort') + 1]).toBe('max');
});

test('listModels returns dynamic agy models for gemini, caches them, and falls back on error', async () => {
  const { root, bin, run, handlers } = await setup();
  await addAccount({ root, provider: 'claude', label: 'cl' });
  await addAccount({ root, provider: 'gemini', label: 'gm' });

  const claudeCatalog = unwrap(await handlers.listModels({ accountLabel: 'cl' }));
  expect(claudeCatalog.models.some((m) => m.id === 'sonnet')).toBe(true);
  expect(run).not.toHaveBeenCalled();

  run.mockResolvedValueOnce({
    exitCode: 0,
    stdout: 'gemini-4-hydrogen-high          Gemini 4 Hydrogen (High)\n',
  });
  const geminiDynamic = unwrap(await handlers.listModels({ accountLabel: 'gm' }));
  expect(geminiDynamic.models).toEqual([
    { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High)' },
  ]);
  expect(run).toHaveBeenCalledTimes(1);

  const cached = unwrap(await handlers.listModels({ accountLabel: 'gm' }));
  expect(cached).toEqual(geminiDynamic);
  expect(run).toHaveBeenCalledTimes(1);

  await addAccount({ root, provider: 'gemini', label: 'gm-fail' });
  run.mockResolvedValueOnce({ exitCode: 1, stdout: '' });
  const fallback = unwrap(await handlers.listModels({ accountLabel: 'gm-fail' }));
  expect(fallback.models.length).toBeGreaterThan(1);

  await addAccount({ root, provider: 'opencode', label: 'oc' });
  await writeFile(join(bin, 'opencode'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  run.mockResolvedValueOnce({
    exitCode: 0,
    stdout: 'deepseek/deepseek-reasoner\nopenai/gpt-5\n',
  });
  const opencodeDynamic = unwrap(await handlers.listModels({ accountLabel: 'oc' }));
  expect(opencodeDynamic.models).toEqual([
    { id: 'deepseek/deepseek-reasoner', label: 'deepseek-reasoner', description: 'deepseek' },
    { id: 'openai/gpt-5', label: 'gpt-5', description: 'openai' },
  ]);
});

test('searchFiles ranks workspace files, caches briefly, and invalidates after turn completion', async () => {
  const { root, handlers } = await setup();
  const { project, session } = await seedSession(root);
  await mkdir(join(project.path, 'src'), { recursive: true });
  await writeFile(join(project.path, 'src', 'alpha.ts'), '');

  const first = unwrap(await handlers.searchFiles({ projectId: project.id, query: 'alpha' }));
  expect(first.files).toEqual(['src/alpha.ts']);

  await writeFile(join(project.path, 'src', 'beta.ts'), '');
  const cached = unwrap(await handlers.searchFiles({ projectId: project.id, query: 'beta' }));
  expect(cached.files).toEqual([]);

  handlers.handleChatEvent(session.id, {
    kind: 'done',
    isError: false,
    costUsd: null,
    durationMs: 10,
  });
  const refreshed = unwrap(await handlers.searchFiles({ projectId: project.id, query: 'beta' }));
  expect(refreshed.files).toEqual(['src/beta.ts']);
});

test('listCommands returns project prompts and skills across providers', async () => {
  const { root, handlers } = await setup();
  const { project } = await seedProject(root);
  await mkdir(join(project.path, '.claude', 'commands'), { recursive: true });
  await writeFile(
    join(project.path, '.claude', 'commands', 'review.md'),
    '---\ndescription: Code review\n---\nReview $ARGUMENTS',
  );

  const commands = unwrap(await handlers.listCommands({ projectId: project.id }));
  expect(commands).toEqual([
    {
      name: 'review',
      description: 'Code review',
      source: 'claude',
      kind: 'command',
      body: 'Review $ARGUMENTS',
    },
  ]);
});

test('provider execution modes validate per-provider support, persist defaults, and pass CLI flags', async () => {
  const { root, handlers, send } = await setup();
  const { project, session } = await seedSession(root);

  const unsupported = await handlers.updateSession({ sessionId: session.id, mode: 'read-only' });
  expect(unsupported.ok).toBe(false);

  const updated = unwrap(await handlers.updateSession({ sessionId: session.id, mode: 'plan' }));
  expect(updated.mode).toBe('plan');

  await handlers.sendMessage({ sessionId: session.id, prompt: 'Planeje' });
  const firstCall = send.mock.calls[0]?.[0];
  expect(firstCall?.spec.args).toContain('--permission-mode');
  const permIdx = firstCall?.spec.args.indexOf('--permission-mode') ?? -1;
  expect(firstCall?.spec.args[permIdx + 1]).toBe('plan');

  const badDefault = await handlers.setDefaultMode({ provider: 'claude', mode: 'read-only' });
  expect(badDefault.ok).toBe(false);

  const savedDefaults = unwrap(await handlers.setDefaultMode({ provider: 'claude', mode: 'auto' }));
  expect(savedDefaults).toEqual({ claude: 'auto' });
  expect(unwrap(await handlers.getDefaultModes())).toEqual({ claude: 'auto' });

  const inheritedSession = unwrap(await handlers.createSession({ projectId: project.id }));
  expect(inheritedSession.mode).toBe('auto');
});

test('worktrees isolate turns, searchFiles sees worktree files, checkpoints restore edits, and verification runs after done', async () => {
  const exec = promisify(execFile);
  const { root, handlers, send, emitted } = await setup();
  await addAccount({ root, provider: 'claude', label: 'work' });
  const repoDir = await tmp();
  await exec('git', ['init', '-b', 'main'], { cwd: repoDir });
  await exec('git', ['config', 'user.email', 'test@inova.dev'], { cwd: repoDir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
  await writeFile(join(repoDir, 'package.json'), JSON.stringify({ scripts: { test: 'echo ok' } }));
  await writeFile(join(repoDir, 'index.ts'), 'export const v = 1;\n');
  await exec('git', ['add', '.'], { cwd: repoDir });
  await exec('git', ['commit', '-m', 'init'], { cwd: repoDir });

  const project = unwrap(await handlers.bindProject({ path: repoDir, accountLabel: 'work' }));
  const detected = unwrap(await handlers.detectProjectChecks({ projectId: project.id }));
  expect(detected.some((c) => c.id === 'test')).toBe(true);

  unwrap(
    await handlers.updateProjectVerification({
      projectId: project.id,
      autoVerify: true,
      verificationChecks: [{ id: 'fail-check', label: 'Falha', command: 'exit 1', enabled: true }],
    }),
  );

  const isolated = unwrap(
    await handlers.createSession({ projectId: project.id, isolatedWorktree: true }),
  );
  expect(isolated.worktree?.branch).toMatch(/^inova\/s-/);
  const wtPath = isolated.worktree!.path;
  await writeFile(join(wtPath, 'only-in-wt.ts'), 'export const w = 2;\n');

  const wtSearch = unwrap(
    await handlers.searchFiles({
      projectId: project.id,
      sessionId: isolated.id,
      query: 'only-in-wt',
    }),
  );
  expect(wtSearch.files).toEqual(['only-in-wt.ts']);

  await handlers.sendMessage({ sessionId: isolated.id, prompt: 'Editar' });
  expect(send.mock.calls[0]?.[0].spec.cwd).toBe(wtPath);
  const checkpointEvent = emitted.find(
    (entry) => entry.sessionId === isolated.id && entry.event.kind === 'checkpoint',
  )?.event;
  expect(checkpointEvent?.kind).toBe('checkpoint');

  await writeFile(join(wtPath, 'index.ts'), 'export const v = 999;\n');
  const statusBeforeApply = unwrap(await handlers.getWorktreeStatus({ sessionId: isolated.id }));
  expect(statusBeforeApply.changedFiles).toContain('index.ts');

  if (checkpointEvent?.kind === 'checkpoint') {
    unwrap(
      await handlers.restoreCheckpoint({
        sessionId: isolated.id,
        ref: checkpointEvent.ref,
      }),
    );
    expect(await readFile(join(wtPath, 'index.ts'), 'utf8')).toBe('export const v = 1;\n');
  }

  await writeFile(join(wtPath, 'index.ts'), 'export const v = 2;\n');
  unwrap(await handlers.applyWorktree({ sessionId: isolated.id }));
  expect(await readFile(join(repoDir, 'index.ts'), 'utf8')).toBe('export const v = 2;\n');

  handlers.handleChatEvent(isolated.id, {
    kind: 'done',
    isError: false,
    costUsd: null,
    durationMs: 10,
  });
  await new Promise((r) => setTimeout(r, 250));
  const verifEvent = emitted
    .filter((entry) => entry.sessionId === isolated.id && entry.event.kind === 'verification')
    .at(-1)?.event;
  expect(verifEvent).toMatchObject({ kind: 'verification', status: 'failed' });

  const nonForcedDelete = await handlers.deleteSession({ sessionId: isolated.id, force: false });
  expect(nonForcedDelete.ok).toBe(false);
  unwrap(await handlers.deleteSession({ sessionId: isolated.id, force: true }));
});

test('turn queue rejects busy account, drains FIFO on done, and tracks inbox notifications', async () => {
  const { root, handlers, send, chatInUse } = await setup();
  const { project, session: s1 } = await seedSession(root);
  const s2 = unwrap(await handlers.createSession({ projectId: project.id }));
  const store = await loadStore(root);
  const accountId = store.accounts[0]!.id;

  unwrap(await handlers.sendMessage({ sessionId: s1.id, prompt: 'Primeiro' }));
  chatInUse.add(accountId);
  const busy = await handlers.sendMessage({ sessionId: s2.id, prompt: 'Na fila' });
  expect(busy.ok).toBe(false);
  if (!busy.ok) expect(busy.message).toContain('CONTA_OCUPADA:');

  const queued = unwrap(await handlers.enqueueTurn({ sessionId: s2.id, prompt: 'Na fila' }));
  expect(unwrap(await handlers.listTurnQueue())).toHaveLength(1);

  const queuedCancel = unwrap(await handlers.enqueueTurn({ sessionId: s2.id, prompt: 'Cancelar' }));
  unwrap(await handlers.cancelQueuedTurn({ turnId: queuedCancel.turnId }));
  expect(unwrap(await handlers.listTurnQueue())).toEqual([queued]);

  chatInUse.delete(accountId);

  handlers.reportUiFocus({ activeSessionId: null, windowFocused: false });
  handlers.handleChatEvent(s1.id, { kind: 'text', blockId: 'b1', text: 'Concluido' });
  handlers.handleChatEvent(s1.id, {
    kind: 'done',
    isError: false,
    costUsd: null,
    durationMs: 10,
  });
  await new Promise((r) => setTimeout(r, 80));

  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]?.[0].sessionId).toBe(s2.id);

  const inbox = unwrap(await handlers.listInbox());
  expect(inbox.some((item) => item.sessionId === s1.id && item.unread)).toBe(true);
  const afterRead = unwrap(await handlers.markInboxRead({ sessionId: s1.id }));
  expect(afterRead.find((item) => item.sessionId === s1.id)?.unread).toBe(false);
  const afterClear = unwrap(await handlers.clearReadInbox());
  expect(afterClear.some((item) => item.sessionId === s1.id)).toBe(false);
});

const OK_DONE = { kind: 'done', isError: false, costUsd: null, durationMs: 1 } as const;
const ERROR_DONE = { kind: 'done', isError: true, costUsd: null, durationMs: 1 } as const;
const flush = async (handlers: ReturnType<typeof createHandlers>, sessionId: string) => {
  await handlers.listInbox();
  await handlers.loadTranscript({ sessionId });
};

async function startQueuedSession() {
  const ctx = await setup();
  const { project, session } = await seedSession(ctx.root);
  const accountId = (await loadStore(ctx.root)).accounts[0]!.id;
  unwrap(await ctx.handlers.sendMessage({ sessionId: session.id, prompt: 'Primeiro' }));
  ctx.chatInUse.add(accountId);
  return { ...ctx, project, session, accountId };
}

test('session queue sends one item after each successful final output', async () => {
  const { handlers, send, chatInUse, session, accountId } = await startQueuedSession();
  unwrap(await handlers.enqueueTurn({ sessionId: session.id, prompt: 'Segundo' }));
  unwrap(await handlers.enqueueTurn({ sessionId: session.id, prompt: 'Terceiro' }));
  expect(send).toHaveBeenCalledTimes(1);

  chatInUse.delete(accountId);
  handlers.handleChatEvent(session.id, OK_DONE);
  await flush(handlers, session.id);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(unwrap(await handlers.listTurnQueue())).toHaveLength(1);

  chatInUse.add(accountId);
  chatInUse.delete(accountId);
  handlers.handleChatEvent(session.id, OK_DONE);
  await flush(handlers, session.id);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  expect(unwrap(await handlers.listTurnQueue())).toHaveLength(0);
});

test('session queue pauses after an error done and resumes on request', async () => {
  const { handlers, send, chatInUse, session, accountId, pausedSnapshots } =
    await startQueuedSession();
  unwrap(await handlers.enqueueTurn({ sessionId: session.id, prompt: 'Segundo' }));

  chatInUse.delete(accountId);
  handlers.handleChatEvent(session.id, ERROR_DONE);
  await flush(handlers, session.id);
  expect(send).toHaveBeenCalledTimes(1);
  expect(unwrap(await handlers.listPausedQueues())).toEqual([session.id]);
  expect(pausedSnapshots.at(-1)).toEqual([session.id]);

  unwrap(await handlers.resumeSessionQueue({ sessionId: session.id }));
  await flush(handlers, session.id);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(unwrap(await handlers.listPausedQueues())).toEqual([]);
  expect(pausedSnapshots.at(-1)).toEqual([]);
});

test('session queue pauses after a cancelled turn and ignores empty queues', async () => {
  const { handlers, send, chatInUse, session, accountId } = await startQueuedSession();
  unwrap(await handlers.enqueueTurn({ sessionId: session.id, prompt: 'Segundo' }));
  handlers.cancelTurn(session.id);
  chatInUse.delete(accountId);
  handlers.handleChatEvent(session.id, ERROR_DONE);
  await flush(handlers, session.id);
  expect(send).toHaveBeenCalledTimes(1);
  expect(unwrap(await handlers.listPausedQueues())).toEqual([session.id]);
});

test('session queue does not pause when an error done leaves the queue empty', async () => {
  const { handlers, chatInUse, session, accountId } = await startQueuedSession();
  chatInUse.delete(accountId);
  handlers.handleChatEvent(session.id, ERROR_DONE);
  await flush(handlers, session.id);
  expect(unwrap(await handlers.listPausedQueues())).toEqual([]);
});

test('account idle does not drain a paused session but drains others', async () => {
  const { handlers, send, chatInUse, idleListeners, session, project, accountId } =
    await startQueuedSession();
  const other = unwrap(await handlers.createSession({ projectId: project.id }));
  unwrap(await handlers.enqueueTurn({ sessionId: session.id, prompt: 'Pausada' }));

  chatInUse.delete(accountId);
  handlers.handleChatEvent(session.id, ERROR_DONE);
  await flush(handlers, session.id);
  chatInUse.delete(accountId);
  for (const listener of idleListeners) listener(accountId);
  await flush(handlers, session.id);
  expect(send).toHaveBeenCalledTimes(1);

  unwrap(await handlers.enqueueTurn({ sessionId: other.id, prompt: 'Livre' }));
  await flush(handlers, session.id);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]?.[0].sessionId).toBe(other.id);
  expect(unwrap(await handlers.listTurnQueue()).map((item) => item.sessionId)).toEqual([
    session.id,
  ]);
});

test('resumeSessionQueue fails and keeps the pause while the account is still exhausted', async () => {
  const { handlers, send, chatInUse, session, accountId, pausedSnapshots } =
    await startQueuedSession();
  unwrap(await handlers.enqueueTurn({ sessionId: session.id, prompt: 'Segundo' }));
  handlers.handleChatEvent(session.id, {
    kind: 'usage-limits',
    windows: [{ kind: 'session', usedPercent: 100, resetsAt: '2026-01-01T05:00:00.000Z' }],
  });
  chatInUse.delete(accountId);
  handlers.handleChatEvent(session.id, ERROR_DONE);
  await flush(handlers, session.id);
  expect(unwrap(await handlers.listPausedQueues())).toEqual([session.id]);

  const result = await handlers.resumeSessionQueue({ sessionId: session.id });
  expect(result.ok ? '' : result.message).toContain('CONTA_ESGOTADA:');
  expect(result.ok ? '' : result.message).toContain('Libera às');
  expect(unwrap(await handlers.listPausedQueues())).toEqual([session.id]);
  expect(pausedSnapshots.at(-1)).toEqual([session.id]);
  expect(send).toHaveBeenCalledTimes(1);
});

test('an ok done on an exhausted account pauses the queue and resume drains after the reset', async () => {
  const { handlers, send, chatInUse, clock, session, accountId, pausedSnapshots, fetch } =
    await startQueuedSession();
  fetch.mockResolvedValue(apiUsage(10, '2026-01-01T09:00:00.000Z'));
  unwrap(await handlers.enqueueTurn({ sessionId: session.id, prompt: 'Segundo' }));
  handlers.handleChatEvent(session.id, {
    kind: 'usage-limits',
    windows: [{ kind: 'session', usedPercent: 100, resetsAt: '2026-01-01T05:00:00.000Z' }],
  });
  chatInUse.delete(accountId);
  handlers.handleChatEvent(session.id, OK_DONE);
  await flush(handlers, session.id);
  expect(unwrap(await handlers.listPausedQueues())).toEqual([session.id]);
  expect(pausedSnapshots.at(-1)).toEqual([session.id]);
  expect(unwrap(await handlers.listTurnQueue())).toHaveLength(1);
  expect(send).toHaveBeenCalledTimes(1);

  clock.iso = '2026-01-01T06:00:00.000Z';
  unwrap(await handlers.resumeSessionQueue({ sessionId: session.id }));
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(unwrap(await handlers.listPausedQueues())).toEqual([]);
});

test('draining an exhausted account pauses every session with queued items', async () => {
  const { handlers, chatInUse, idleListeners, session, project, accountId } =
    await startQueuedSession();
  const other = unwrap(await handlers.createSession({ projectId: project.id }));
  unwrap(await handlers.enqueueTurn({ sessionId: other.id, prompt: 'Outra' }));
  handlers.handleChatEvent(session.id, {
    kind: 'usage-limits',
    windows: [{ kind: 'session', usedPercent: 100, resetsAt: null }],
  });
  chatInUse.delete(accountId);
  for (const listener of idleListeners) listener(accountId);
  expect(unwrap(await handlers.listPausedQueues())).toEqual([other.id]);
  await flush(handlers, session.id);
});

test('cancelling the last queued turn clears the session pause', async () => {
  const { handlers, chatInUse, session, accountId, pausedSnapshots } = await startQueuedSession();
  const first = unwrap(await handlers.enqueueTurn({ sessionId: session.id, prompt: 'A' }));
  const second = unwrap(await handlers.enqueueTurn({ sessionId: session.id, prompt: 'B' }));
  chatInUse.delete(accountId);
  handlers.handleChatEvent(session.id, ERROR_DONE);
  await flush(handlers, session.id);
  unwrap(await handlers.cancelQueuedTurn({ turnId: first.turnId }));
  expect(unwrap(await handlers.listPausedQueues())).toEqual([session.id]);
  unwrap(await handlers.cancelQueuedTurn({ turnId: second.turnId }));
  expect(unwrap(await handlers.listPausedQueues())).toEqual([]);
  expect(pausedSnapshots.at(-1)).toEqual([]);
});

test('production order: done while account in use, then idle, runs the finished session first', async () => {
  const { handlers, send, chatInUse, idleListeners, session, project, accountId } =
    await startQueuedSession();
  const other = unwrap(await handlers.createSession({ projectId: project.id }));
  unwrap(await handlers.enqueueTurn({ sessionId: other.id, prompt: 'Antiga de outra sessão' }));
  unwrap(await handlers.enqueueTurn({ sessionId: session.id, prompt: 'Da mesma sessão' }));

  handlers.handleChatEvent(session.id, OK_DONE);
  await flush(handlers, session.id);
  expect(send).toHaveBeenCalledTimes(1);

  chatInUse.delete(accountId);
  for (const listener of idleListeners) listener(accountId);
  await flush(handlers, session.id);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]?.[0].sessionId).toBe(session.id);
  expect(unwrap(await handlers.listTurnQueue()).map((item) => item.sessionId)).toEqual([other.id]);
});

test('deleting a session clears its queue pause', async () => {
  const { handlers, chatInUse, session, accountId } = await startQueuedSession();
  unwrap(await handlers.enqueueTurn({ sessionId: session.id, prompt: 'Segundo' }));
  chatInUse.delete(accountId);
  handlers.handleChatEvent(session.id, ERROR_DONE);
  await flush(handlers, session.id);
  unwrap(await handlers.deleteSession({ sessionId: session.id, force: true }));
  expect(unwrap(await handlers.listPausedQueues())).toEqual([]);
});

test('queued turn passes its extra directories to the claude args', async () => {
  const { handlers, send, chatInUse, session, accountId } = await startQueuedSession();
  unwrap(
    await handlers.enqueueTurn({
      sessionId: session.id,
      prompt: '@/Users/me/Downloads/doc.pdf resuma',
      extraDirs: ['/Users/me/Downloads'],
    }),
  );
  chatInUse.delete(accountId);
  handlers.handleChatEvent(session.id, OK_DONE);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  const args = send.mock.calls[1]?.[0]?.spec.args ?? [];
  expect(args[args.indexOf('--add-dir') + 1]).toBe('/Users/me/Downloads');
});

test('switchSessionAccount, handoffSession, and forkSession preserve context across turns and providers', async () => {
  const { root, handlers, send } = await setup();
  const { project, session } = await seedSession(root);
  const altAccount = await addAccount({ root, provider: 'codex', label: 'codex-alt' });

  handlers.handleChatEvent(session.id, {
    kind: 'session',
    providerSessionId: 'cli-sess-1',
  });
  handlers.handleChatEvent(session.id, { kind: 'user', text: 'Turno 0', at: 't0' });
  handlers.handleChatEvent(session.id, { kind: 'text', blockId: 'b0', text: 'Resp 0' });
  handlers.handleChatEvent(session.id, {
    kind: 'done',
    isError: false,
    costUsd: null,
    durationMs: 5,
  });
  handlers.handleChatEvent(session.id, { kind: 'user', text: 'Turno 1', at: 't1' });
  handlers.handleChatEvent(session.id, { kind: 'text', blockId: 'b1', text: 'Resp 1' });
  handlers.handleChatEvent(session.id, {
    kind: 'done',
    isError: false,
    costUsd: null,
    durationMs: 5,
  });

  const nativeFork = unwrap(await handlers.forkSession({ sessionId: session.id, turnIndex: 1 }));
  expect(nativeFork.strategy).toBe('native-claude');

  const partialFork = unwrap(
    await handlers.forkSession({
      sessionId: session.id,
      turnIndex: 0,
      targetAccountId: altAccount.id,
    }),
  );
  expect(partialFork.strategy).toBe('summary-handoff');
  expect(partialFork.session.handoffContext).toContain('Turno 0');
  expect(partialFork.session.handoffContext).not.toContain('Turno 1');

  const handoff = unwrap(
    await handlers.handoffSession({ sessionId: session.id, targetAccountId: altAccount.id }),
  );
  expect(handoff.handoffContext).toContain('Contexto de handoff');

  const s2 = unwrap(await handlers.createSession({ projectId: project.id }));
  handlers.handleChatEvent(s2.id, { kind: 'user', text: 'Inicio', at: 't0' });
  handlers.handleChatEvent(s2.id, {
    kind: 'error',
    message: '429 rate_limit_exceeded',
  });
  handlers.handleChatEvent(s2.id, {
    kind: 'done',
    isError: true,
    costUsd: null,
    durationMs: 5,
  });
  await new Promise((r) => setTimeout(r, 40));

  const switched = unwrap(
    await handlers.switchSessionAccount({
      sessionId: s2.id,
      accountId: altAccount.id,
      generateHandoff: true,
    }),
  );
  expect(switched.hadHistory).toBe(true);
  expect(switched.session.accountIdOverride).toBe(altAccount.id);

  unwrap(await handlers.sendMessage({ sessionId: s2.id, prompt: 'Continuar' }));
  expect(send.mock.calls[0]?.[0].provider).toBe('codex');
  expect(send.mock.calls[0]?.[0].spec.args.join(' ')).toContain('Contexto de handoff');
});

async function seedRewindSession(
  root: string,
  handlers: ReturnType<typeof createHandlers>,
  options: { largeFile?: string } = {},
) {
  const exec = promisify(execFile);
  await addAccount({ root, provider: 'claude', label: 'pessoal' });
  const repoDir = await tmp();
  await exec('git', ['init', '-b', 'main'], { cwd: repoDir });
  await exec('git', ['config', 'user.email', 'test@inova.dev'], { cwd: repoDir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
  await writeFile(join(repoDir, 'index.ts'), 'export const v = 1;\n');
  await exec('git', ['add', '.'], { cwd: repoDir });
  await exec('git', ['commit', '-m', 'init'], { cwd: repoDir });
  const project = await bindProject({ root, path: repoDir, accountLabel: 'pessoal' });
  const session = await createSession({ root, projectId: project.id });
  const turns = ['Turno 0', 'Turno 1'];
  const refs: string[] = [];
  if (options.largeFile !== undefined) {
    await writeFile(join(repoDir, options.largeFile), 'x'.repeat(64));
  }
  handlers.handleChatEvent(session.id, { kind: 'session', providerSessionId: 'cli-sess-1' });
  for (const [index, text] of turns.entries()) {
    await writeFile(join(repoDir, 'index.ts'), `export const v = ${index + 1};\n`);
    const snapshot = await createCheckpoint({
      repoPath: repoDir,
      sessionId: session.id,
      turnId: `u${index}`,
      ...(options.largeFile === undefined ? {} : { maxFileBytes: 40 }),
    });
    if (!snapshot) throw new Error('checkpoint not created');
    refs.push(snapshot.ref);
    handlers.handleChatEvent(session.id, {
      kind: 'checkpoint',
      turnId: `u${index}`,
      ref: snapshot.ref,
      createdAt: `t${index}`,
      skippedLargeFiles: snapshot.skippedLargeFiles,
    });
    handlers.handleChatEvent(session.id, { kind: 'user', text, at: `t${index}` });
    handlers.handleChatEvent(session.id, {
      kind: 'text',
      blockId: `b${index}`,
      text: `Resp ${index}`,
    });
    handlers.handleChatEvent(session.id, {
      kind: 'done',
      isError: false,
      costUsd: null,
      durationMs: 5,
    });
  }
  await writeFile(join(repoDir, 'index.ts'), 'export const v = 99;\n');
  await new Promise((r) => setTimeout(r, 40));
  return { repoDir, session, refs };
}

test('rewindSession restores files, truncates the transcript, and resets agent memory', async () => {
  const { root, handlers } = await setup();
  const { repoDir, session } = await seedRewindSession(root, handlers);
  const before = unwrap(await handlers.loadTranscript({ sessionId: session.id }));

  const rewound = unwrap(await handlers.rewindSession({ sessionId: session.id, turnIndex: 1 }));

  expect(rewound).toEqual({ text: 'Turno 1' });
  expect(await readFile(join(repoDir, 'index.ts'), 'utf8')).toBe('export const v = 2;\n');
  const after = unwrap(await handlers.loadTranscript({ sessionId: session.id }));
  expect(after).toEqual(before.slice(0, before.map((e) => e.kind).lastIndexOf('checkpoint')));
  expect(after.some((e) => e.kind === 'user' && e.text === 'Turno 1')).toBe(false);
  const stored = (await loadStore(root)).sessions?.find((item) => item.id === session.id);
  expect(stored?.providerSessionId).toBeNull();
  expect(stored?.handoffContext).toContain('Turno 0');
  expect(stored?.handoffContext).not.toContain('Turno 1');
});

test('rewindSession of the first turn clears the handoff context', async () => {
  const { root, handlers } = await setup();
  const { session } = await seedRewindSession(root, handlers);

  const rewound = unwrap(await handlers.rewindSession({ sessionId: session.id, turnIndex: 0 }));

  expect(rewound).toEqual({ text: 'Turno 0' });
  expect(unwrap(await handlers.loadTranscript({ sessionId: session.id }))).toEqual([
    { kind: 'session', providerSessionId: 'cli-sess-1' },
  ]);
  const stored = (await loadStore(root)).sessions?.find((item) => item.id === session.id);
  expect(stored?.providerSessionId).toBeNull();
  expect(stored?.handoffContext).toBeNull();
});

test('rewindSession skips file restore when the turn has no checkpoint', async () => {
  const { root, handlers } = await setup();
  const { project, session } = await seedSession(root);
  handlers.handleChatEvent(session.id, { kind: 'session', providerSessionId: 'cli-sess-1' });
  handlers.handleChatEvent(session.id, { kind: 'user', text: 'Turno 0', at: 't0' });
  handlers.handleChatEvent(session.id, {
    kind: 'done',
    isError: false,
    costUsd: null,
    durationMs: 1,
  });
  handlers.handleChatEvent(session.id, { kind: 'user', text: 'Turno 1', at: 't1' });
  await new Promise((r) => setTimeout(r, 40));
  await writeFile(join(project.path, 'keep.txt'), 'untouched');

  const rewound = unwrap(await handlers.rewindSession({ sessionId: session.id, turnIndex: 1 }));

  expect(rewound).toEqual({ text: 'Turno 1' });
  expect(await readFile(join(project.path, 'keep.txt'), 'utf8')).toBe('untouched');
  const after = unwrap(await handlers.loadTranscript({ sessionId: session.id }));
  expect(after.filter((e) => e.kind === 'user')).toHaveLength(1);
  const stored = (await loadStore(root)).sessions?.find((item) => item.id === session.id);
  expect(stored?.providerSessionId).toBeNull();
});

test('rewinding a child session to turn 0 detaches it so the next turn does not fork the parent', async () => {
  const { root, send, handlers } = await setup();
  const { project, session: parent } = await seedSession(root);
  await updateSession({ root, sessionId: parent.id, patch: { providerSessionId: 'parent-prov' } });
  const child = await createSession({ root, projectId: project.id, parentId: parent.id });
  handlers.handleChatEvent(child.id, { kind: 'user', text: 'Turno 0', at: 't0' });
  handlers.handleChatEvent(child.id, {
    kind: 'done',
    isError: false,
    costUsd: null,
    durationMs: 1,
  });
  await new Promise((r) => setTimeout(r, 40));

  unwrap(await handlers.rewindSession({ sessionId: child.id, turnIndex: 0 }));
  const stored = (await loadStore(root)).sessions?.find((item) => item.id === child.id);
  expect(stored?.detachedFromParent).toBe(true);
  expect(stored?.providerSessionId).toBeNull();

  unwrap(await handlers.sendMessage({ sessionId: child.id, prompt: 'de novo' }));
  const args = send.mock.calls[0]?.[0].spec.args ?? [];
  expect(args).not.toContain('--fork-session');
  expect(args).not.toContain('parent-prov');
  expect(args).toContain('--session-id');
});

test('rewindSession fails without touching files or transcript while a turn is running', async () => {
  const { root, handlers, running } = await setup();
  const { repoDir, session } = await seedRewindSession(root, handlers);
  const before = unwrap(await handlers.loadTranscript({ sessionId: session.id }));
  running.add(session.id);

  const result = await handlers.rewindSession({ sessionId: session.id, turnIndex: 1 });

  expect(result.ok).toBe(false);
  expect(await readFile(join(repoDir, 'index.ts'), 'utf8')).toBe('export const v = 99;\n');
  expect(unwrap(await handlers.loadTranscript({ sessionId: session.id }))).toEqual(before);
  const stored = (await loadStore(root)).sessions?.find((item) => item.id === session.id);
  expect(stored?.providerSessionId).toBe('cli-sess-1');
});

test('rewindSession keeps files the checkpoint skipped for being too large', async () => {
  const { root, handlers } = await setup();
  const { repoDir, session } = await seedRewindSession(root, handlers, { largeFile: 'big.bin' });

  unwrap(await handlers.rewindSession({ sessionId: session.id, turnIndex: 1 }));

  expect(await readFile(join(repoDir, 'big.bin'), 'utf8')).toBe('x'.repeat(64));
  expect(await readFile(join(repoDir, 'index.ts'), 'utf8')).toBe('export const v = 2;\n');
});

test('rewindSession refuses while another running session shares the working tree', async () => {
  const { root, handlers, running } = await setup();
  const { repoDir, session } = await seedRewindSession(root, handlers);
  const other = await createSession({ root, projectId: session.projectId });
  running.add(other.id);
  const before = unwrap(await handlers.loadTranscript({ sessionId: session.id }));

  const result = await handlers.rewindSession({ sessionId: session.id, turnIndex: 1 });

  expect(result).toEqual({
    ok: false,
    message: 'Outra sessão está rodando neste repositório. Pare-a antes de retroceder.',
  });
  expect(await readFile(join(repoDir, 'index.ts'), 'utf8')).toBe('export const v = 99;\n');
  expect(unwrap(await handlers.loadTranscript({ sessionId: session.id }))).toEqual(before);
});

test('recordFeedback appends a feedback event to the transcript and validates input', async () => {
  const { root, handlers } = await setup();
  const { session } = await seedRewindSession(root, handlers);
  const before = unwrap(await handlers.loadTranscript({ sessionId: session.id }));

  unwrap(await handlers.recordFeedback({ sessionId: session.id, turnIndex: 0, value: 'up' }));
  unwrap(await handlers.recordFeedback({ sessionId: session.id, turnIndex: 0, value: null }));

  expect(unwrap(await handlers.loadTranscript({ sessionId: session.id }))).toEqual([
    ...before,
    { kind: 'feedback', turnIndex: 0, value: 'up' },
    { kind: 'feedback', turnIndex: 0, value: null },
  ]);
  expect(
    await handlers.recordFeedback({ sessionId: session.id, turnIndex: 0, value: 'meh' }),
  ).toEqual(INVALID);
  expect((await handlers.recordFeedback({ sessionId: 'nope', turnIndex: 0, value: 'up' })).ok).toBe(
    false,
  );
});

test('rewindSession keeps feedback of earlier turns recorded after the cut point', async () => {
  const { root, handlers } = await setup();
  const { session } = await seedRewindSession(root, handlers);
  unwrap(await handlers.recordFeedback({ sessionId: session.id, turnIndex: 0, value: 'up' }));
  unwrap(await handlers.recordFeedback({ sessionId: session.id, turnIndex: 1, value: 'down' }));

  unwrap(await handlers.rewindSession({ sessionId: session.id, turnIndex: 1 }));

  const after = unwrap(await handlers.loadTranscript({ sessionId: session.id }));
  const feedback = after.filter((event) => event.kind === 'feedback');
  expect(feedback).toEqual([{ kind: 'feedback', turnIndex: 0, value: 'up' }]);
});

test('rewindSession rejects an unknown turn and invalid input without side effects', async () => {
  const { root, handlers } = await setup();
  const { repoDir, session } = await seedRewindSession(root, handlers);
  const before = unwrap(await handlers.loadTranscript({ sessionId: session.id }));

  expect((await handlers.rewindSession({ sessionId: session.id, turnIndex: 5 })).ok).toBe(false);
  expect(await handlers.rewindSession({ sessionId: session.id, turnIndex: -1 })).toEqual(INVALID);
  expect(await readFile(join(repoDir, 'index.ts'), 'utf8')).toBe('export const v = 99;\n');
  expect(unwrap(await handlers.loadTranscript({ sessionId: session.id }))).toEqual(before);
});

test('rewindSession leaves state intact when checkpoint restore throws', async () => {
  const { root, handlers } = await setup();
  const { repoDir, session, refs } = await seedRewindSession(root, handlers);
  const exec = promisify(execFile);
  const commitFile = join(await tmp(), 'broken-commit');
  await writeFile(
    commitFile,
    `tree ${'1'.repeat(40)}\nauthor T <t@inova.dev> 0 +0000\ncommitter T <t@inova.dev> 0 +0000\n\nbroken\n`,
  );
  const { stdout: brokenCommit } = await exec(
    'git',
    ['hash-object', '-t', 'commit', '-w', '--literally', commitFile],
    { cwd: repoDir },
  );
  await exec('git', ['update-ref', refs[1] ?? '', brokenCommit.trim()], { cwd: repoDir });
  const before = unwrap(await handlers.loadTranscript({ sessionId: session.id }));

  await expect(handlers.rewindSession({ sessionId: session.id, turnIndex: 1 })).rejects.toThrow();

  expect(unwrap(await handlers.loadTranscript({ sessionId: session.id }))).toEqual(before);
  const stored = (await loadStore(root)).sessions?.find((item) => item.id === session.id);
  expect(stored?.providerSessionId).toBe('cli-sess-1');
});

test('rewindSession keeps transcript and session intact when the checkpoint restore fails', async () => {
  const { root, handlers } = await setup();
  const { session } = await seedSession(root);
  handlers.handleChatEvent(session.id, { kind: 'session', providerSessionId: 'cli-sess-1' });
  handlers.handleChatEvent(session.id, {
    kind: 'checkpoint',
    turnId: 'u0',
    ref: 'refs/inova/checkpoints/missing/0',
    createdAt: 't0',
    skippedLargeFiles: [],
  });
  handlers.handleChatEvent(session.id, { kind: 'user', text: 'Turno 0', at: 't0' });
  await new Promise((r) => setTimeout(r, 40));
  const before = unwrap(await handlers.loadTranscript({ sessionId: session.id }));

  const result = await handlers.rewindSession({ sessionId: session.id, turnIndex: 0 });

  expect(result).toEqual({
    ok: false,
    message: 'O checkpoint deste turno não existe mais. Não é possível desfazer os arquivos.',
  });
  expect(unwrap(await handlers.loadTranscript({ sessionId: session.id }))).toEqual(before);
  const stored = (await loadStore(root)).sessions?.find((item) => item.id === session.id);
  expect(stored?.providerSessionId).toBe('cli-sess-1');
});

test('startComparison runs two isolated sessions in parallel, computes diffs, and applies winner', async () => {
  const exec = promisify(execFile);
  const { root, handlers, send } = await setup();
  const leftAcc = await addAccount({ root, provider: 'claude', label: 'cmp-claude' });
  const rightAcc = await addAccount({ root, provider: 'codex', label: 'cmp-codex' });
  const repoDir = await tmp();
  await exec('git', ['init', '-b', 'main'], { cwd: repoDir });
  await exec('git', ['config', 'user.email', 'test@inova.dev'], { cwd: repoDir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
  await writeFile(join(repoDir, 'file.ts'), 'export const n = 1;\n');
  await exec('git', ['add', '.'], { cwd: repoDir });
  await exec('git', ['commit', '-m', 'init'], { cwd: repoDir });
  const project = unwrap(await handlers.bindProject({ path: repoDir, accountLabel: 'cmp-claude' }));

  const started = unwrap(
    await handlers.startComparison({
      projectId: project.id,
      prompt: 'Implemente feature X',
      leftAccountId: leftAcc.id,
      rightAccountId: rightAcc.id,
      leftEffort: 'high',
      rightMode: 'read-only',
    }),
  );

  expect(started.left.comparisonGroupId).toBe(started.groupId);
  expect(started.left.comparisonRole).toBe('left');
  expect(started.right.comparisonRole).toBe('right');
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  const cwds = send.mock.calls.map((call) => call[0].spec.cwd);
  expect(cwds).toContain(started.left.worktree?.path);
  expect(cwds).toContain(started.right.worktree?.path);

  await writeFile(join(started.left.worktree!.path, 'file.ts'), 'export const n = 10;\n');
  await writeFile(join(started.right.worktree!.path, 'file.ts'), 'export const n = 20;\n');

  const diff = unwrap(await handlers.getComparisonDiff({ groupId: started.groupId }));
  expect(diff.files[0]?.path).toBe('file.ts');
  expect(diff.files[0]?.leftDiff).toContain('+export const n = 10;');
  expect(diff.files[0]?.rightDiff).toContain('+export const n = 20;');

  const resolved = unwrap(
    await handlers.resolveComparison({
      groupId: started.groupId,
      winner: 'right',
      cleanupWorktrees: true,
    }),
  );
  expect(resolved.winnerSessionId).toBe(started.right.id);
  expect(await readFile(join(repoDir, 'file.ts'), 'utf8')).toBe('export const n = 20;\n');
});

test('previewProfileSync and applyProfileSync synchronize .mcp.json and project rules with backups', async () => {
  const { root, handlers } = await setup();
  const claudeAcc = await addAccount({ root, provider: 'claude', label: 'sync-claude' });
  const codexAcc = await addAccount({ root, provider: 'codex', label: 'sync-codex' });
  const repoDir = await tmp();
  await writeFile(
    join(repoDir, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        linear: {
          command: 'npx',
          args: ['-y', '@linear/mcp'],
          env: { LINEAR_TOKEN: 'lin_secret_xyz' },
        },
      },
    }),
  );
  await writeFile(join(repoDir, 'AGENTS.md'), '# Regras oficiais\n');
  const project = unwrap(
    await handlers.bindProject({ path: repoDir, accountLabel: claudeAcc.label }),
  );

  const preview = unwrap(
    await handlers.previewProfileSync({
      projectId: project.id,
      accountIds: [claudeAcc.id, codexAcc.id],
      rulesSource: 'AGENTS.md',
    }),
  );
  expect(preview.mcpServerCount).toBe(1);
  expect(
    preview.items.some((item) => item.id === 'rules:CLAUDE.md' && item.status === 'create'),
  ).toBe(true);

  const applied = unwrap(
    await handlers.applyProfileSync({
      projectId: project.id,
      accountIds: [claudeAcc.id, codexAcc.id],
      rulesSource: 'AGENTS.md',
      approvedIds: preview.items.map((item) => item.id),
      rulesStrategy: 'copy',
    }),
  );
  expect(applied.appliedIds).toContain(`mcp:${codexAcc.id}`);
  expect(await readFile(join(repoDir, 'CLAUDE.md'), 'utf8')).toBe('# Regras oficiais\n');
  expect(await readFile(join(codexAcc.homeDir, 'config.toml'), 'utf8')).toContain(
    '[mcp_servers.linear]',
  );
});

test('startComparison rejects unsupported effort without leaving orphan sessions or worktrees', async () => {
  const { root, handlers } = await setup();
  const repoDir = await tmp();
  const claudeAcc = await addAccount({ root, provider: 'claude', label: 'cmp-c' });
  const qwenAcc = await addAccount({ root, provider: 'qwen', label: 'cmp-q' });
  const project = unwrap(
    await handlers.bindProject({ path: repoDir, accountLabel: claudeAcc.label }),
  );

  const res = await handlers.startComparison({
    projectId: project.id,
    prompt: 'Implementar algo',
    leftAccountId: claudeAcc.id,
    rightAccountId: qwenAcc.id,
    rightEffort: 'high',
  });
  expect(res.ok).toBe(false);
  expect(unwrap(await handlers.listSessions({ projectId: project.id }))).toHaveLength(0);
});

const EXTERNAL_ID = '11111111-1111-4111-8111-111111111111';

async function seedExternalClaudeSession(input: { home: string; projectPath: string }) {
  const dir = join(input.home, '.claude', 'projects', claudeProjectDirName(input.projectPath));
  await mkdir(dir, { recursive: true });
  const lines = [
    {
      type: 'user',
      cwd: input.projectPath,
      timestamp: '2026-11-01T10:00:00.000Z',
      message: { role: 'user', content: 'Corrija o login' },
    },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Corrigido.' }] } },
  ];
  await writeFile(
    join(dir, `${EXTERNAL_ID}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
  );
}

test('importSessions copies the external session into the account and resumes it', async () => {
  const home = await tmp();
  const { root, handlers, send } = await setup({ home });
  const { account, project } = await seedProject(root);
  await seedExternalClaudeSession({ home, projectPath: project.path });

  const listed = unwrap(await handlers.listExternalSessions({ projectId: project.id }));
  expect(listed).toMatchObject([
    { provider: 'claude', id: EXTERNAL_ID, title: 'Corrija o login', imported: false },
  ]);

  const [session] = unwrap(
    await handlers.importSessions({
      projectId: project.id,
      provider: 'claude',
      accountId: account.id,
      sessionIds: [EXTERNAL_ID],
    }),
  );
  expect(session).toMatchObject({ title: 'Corrija o login', providerSessionId: EXTERNAL_ID });
  expect(session?.accountIdOverride).toBeUndefined();
  const copied = join(
    account.homeDir,
    'projects',
    claudeProjectDirName(project.path),
    `${EXTERNAL_ID}.jsonl`,
  );
  expect(await readFile(copied, 'utf8')).toContain('Corrija o login');
  const transcript = unwrap(await handlers.loadTranscript({ sessionId: session?.id }));
  expect(transcript.map((event) => event.kind)).toEqual(['user', 'text', 'done']);

  unwrap(await handlers.sendMessage({ sessionId: session?.id, prompt: 'continue' }));
  const args = send.mock.calls[0]?.[0].spec.args ?? [];
  expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2)).toEqual([
    '--resume',
    EXTERNAL_ID,
  ]);

  const relisted = unwrap(await handlers.listExternalSessions({ projectId: project.id }));
  expect(relisted[0]?.imported).toBe(true);
  const again = await handlers.importSessions({
    projectId: project.id,
    provider: 'claude',
    accountId: account.id,
    sessionIds: [EXTERNAL_ID],
  });
  expect(again.ok).toBe(false);
});

test('importSessions targets another account of the same provider and rejects other providers', async () => {
  const home = await tmp();
  const { root, handlers } = await setup({ home });
  const { project } = await seedProject(root);
  const other = await addAccount({ root, provider: 'claude', label: 'trabalho' });
  const codex = await addAccount({ root, provider: 'codex', label: 'cx' });
  await seedExternalClaudeSession({ home, projectPath: project.path });
  const base = { projectId: project.id, provider: 'claude', sessionIds: [EXTERNAL_ID] };

  expect((await handlers.importSessions({ ...base, accountId: codex.id })).ok).toBe(false);
  expect((await handlers.importSessions({ ...base, accountId: 'missing' })).ok).toBe(false);
  expect(await handlers.importSessions({ ...base, sessionIds: ['../x'] })).toEqual(INVALID);
  expect(unwrap(await handlers.listSessions({ projectId: project.id }))).toHaveLength(0);

  const [session] = unwrap(await handlers.importSessions({ ...base, accountId: other.id }));
  expect(session?.accountIdOverride).toBe(other.id);
});

test('settings default, update through the handler, reject invalid patches, and persist', async () => {
  const { root, handlers } = await setup();
  const defaults = unwrap(await handlers.getSettings());
  expect(defaults.notifications).toEqual({
    waitingInput: true,
    failed: true,
    completed: false,
    onlyWhenUnfocused: true,
  });
  expect(defaults.sessions.autoArchiveDays).toBe(0);

  const updated = unwrap(
    await handlers.updateSettings({ sessions: { autoArchiveDays: 7 }, voice: { language: 'pt' } }),
  );
  expect(updated.sessions).toEqual({ autoArchiveDays: 7, collapseFinishedTurns: true });
  expect(updated.voice.language).toBe('pt');
  expect(unwrap(await handlers.getSettings())).toEqual(updated);
  expect((await loadStore(root)).settings).toEqual(updated);

  for (const input of [null, { sessions: { autoArchiveDays: 2 } }, { unknown: {} }]) {
    expect(await handlers.updateSettings(input)).toEqual(INVALID);
  }
  expect(unwrap(await handlers.getSettings())).toEqual(updated);
});

test('sendTestNotification reports a notification the system blocked', async () => {
  const { handlers, notify } = await setup();
  notify.mockResolvedValueOnce({ ok: false, message: 'bloqueada' });
  expect(await handlers.sendTestNotification()).toEqual({ ok: false, message: 'bloqueada' });
});

test('sendTestNotification notifies with the fixed title and body', async () => {
  const { handlers, notify } = await setup();
  unwrap(await handlers.sendTestNotification());
  expect(notify).toHaveBeenCalledExactlyOnceWith({
    title: 'Inova',
    body: 'Notificação de teste',
  });
});

test('openDataFolder creates and opens the data root and reports failures', async () => {
  const { root, handlers, openPath } = await setup();
  await rm(root, { recursive: true, force: true });
  unwrap(await handlers.openDataFolder());
  expect(openPath).toHaveBeenCalledExactlyOnceWith(root);
  expect(await readdir(root)).toEqual([]);

  openPath.mockRejectedValueOnce(new Error('no file manager'));
  expect(await handlers.openDataFolder()).toEqual({
    ok: false,
    message: 'Não foi possível abrir a pasta de dados.',
  });

  const without = await setup({ withOpenPath: false });
  expect((await without.handlers.openDataFolder()).ok).toBe(false);
});

test.each([
  ['failed', {}, false, 1],
  ['failed', {}, true, 0],
  ['failed', { notifications: { failed: false } }, false, 0],
  ['failed', { notifications: { onlyWhenUnfocused: false } }, true, 1],
  ['waiting-input', {}, false, 1],
  ['waiting-input', { notifications: { waitingInput: false } }, false, 0],
  ['completed', {}, false, 0],
  ['completed', { notifications: { completed: true } }, false, 1],
  ['completed', { notifications: { completed: true } }, true, 0],
  ['completed', { notifications: { completed: true, onlyWhenUnfocused: false } }, true, 1],
] as const)(
  'notification for %s with settings %j and windowFocused=%s fires %i time(s)',
  async (kind, patch, windowFocused, expectedCalls) => {
    const { root, handlers, notify } = await setup();
    const { session } = await seedSession(root);
    unwrap(await handlers.updateSettings(patch));
    handlers.reportUiFocus({ activeSessionId: null, windowFocused });
    if (kind === 'waiting-input') {
      handlers.handleChatEvent(session.id, { kind: 'error', message: '429 rate_limit_exceeded' });
    }
    handlers.handleChatEvent(session.id, {
      kind: 'done',
      isError: kind !== 'completed',
      costUsd: null,
      durationMs: 5,
    });
    await handlers.listInbox();
    expect(notify).toHaveBeenCalledTimes(expectedCalls);
  },
);

test('runAutoArchive archives only idle expired root sessions and skips busy ones', async () => {
  const { root, handlers, running, chatInUse } = await setup();
  const { account, project } = await seedProject(root);
  const staleDate = new Date('2025-12-01T00:00:00.000Z');
  const make = (parentId: string | null = null, at = staleDate) =>
    createSession({ root, projectId: project.id, parentId, now: () => at });
  const idle = await make();
  const idleChild = await make(idle.id);
  await make(null, new Date('2025-12-31T00:00:00.000Z'));
  const executing = await make();
  const parentOfExecuting = await make();
  const executingChild = await make(parentOfExecuting.id);
  const opened = await make();
  const focused = await make();
  const unread = await make();
  const queued = await make();
  running.add(executing.id);
  running.add(executingChild.id);
  unwrap(await handlers.saveWorkspace({ openSessionIds: [opened.id], activeSessionId: null }));
  handlers.reportUiFocus({ activeSessionId: focused.id, windowFocused: true });
  handlers.handleChatEvent(unread.id, {
    kind: 'done',
    isError: true,
    costUsd: null,
    durationMs: 1,
  });
  await handlers.listInbox();
  chatInUse.add(account.id);
  unwrap(await handlers.enqueueTurn({ sessionId: queued.id, prompt: 'depois' }));

  const archivedIds = async (): Promise<string[]> =>
    ((await loadStore(root)).sessions ?? [])
      .filter((session) => session.archivedAt !== null)
      .map((session) => session.id)
      .sort();

  expect(await handlers.runAutoArchive()).toEqual([]);
  expect(await archivedIds()).toEqual([]);

  unwrap(await handlers.updateSettings({ sessions: { autoArchiveDays: 7 } }));
  expect(await handlers.runAutoArchive()).toEqual([idle.id]);
  expect(await archivedIds()).toEqual([idle.id, idleChild.id].sort());

  unwrap(await handlers.markInboxRead({ sessionId: unread.id }));
  expect(await handlers.runAutoArchive()).toEqual([unread.id]);
  expect(await archivedIds()).toEqual([idle.id, idleChild.id, unread.id].sort());
});

test('sendMessage expands a project command for a codex session but records the original text', async () => {
  const { root, send, emitted, handlers } = await setup();
  await addAccount({ root, provider: 'codex', label: 'cx' });
  const project = await bindProject({ root, path: await tmp(), accountLabel: 'cx' });
  await mkdir(join(project.path, '.claude', 'commands'), { recursive: true });
  await writeFile(
    join(project.path, '.claude', 'commands', 'minha-skill.md'),
    'Faça isto: $ARGUMENTS',
  );
  const session = await createSession({ root, projectId: project.id });

  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: '/minha-skill arg' }));

  const args = send.mock.calls[0]?.[0].spec.args ?? [];
  expect(args.join(' ')).toContain('Faça isto: arg');
  expect(args.join(' ')).not.toContain('/minha-skill');
  expect(emitted.some((e) => e.event.kind === 'user' && e.event.text === '/minha-skill arg')).toBe(
    true,
  );
});

test('sendMessage expands a codex project command that carries file mentions', async () => {
  const { root, send, handlers } = await setup();
  await addAccount({ root, provider: 'codex', label: 'cx' });
  const project = await bindProject({ root, path: await tmp(), accountLabel: 'cx' });
  await mkdir(join(project.path, '.claude', 'commands'), { recursive: true });
  await writeFile(
    join(project.path, '.claude', 'commands', 'minha-skill.md'),
    'Faça isto: $ARGUMENTS',
  );
  const session = await createSession({ root, projectId: project.id });

  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: '/minha-skill @a.ts arg' }));

  const args = send.mock.calls[0]?.[0].spec.args ?? [];
  expect(args.join(' ')).toContain('Faça isto: @a.ts arg');
});

test('sendMessage passes a project command through literally for a claude session', async () => {
  const { root, send, handlers } = await setup();
  const { project, session } = await seedSession(root);
  await mkdir(join(project.path, '.claude', 'commands'), { recursive: true });
  await writeFile(join(project.path, '.claude', 'commands', 'minha-skill.md'), 'Faça isto');

  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: '/minha-skill arg' }));

  const args = send.mock.calls[0]?.[0].spec.args ?? [];
  expect(args.at(-1)).toBe('/minha-skill arg');
});

test('sendMessage expands a gemini project command for a claude session', async () => {
  const { root, send, handlers } = await setup();
  const { project, session } = await seedSession(root);
  await mkdir(join(project.path, '.gemini', 'commands'), { recursive: true });
  await writeFile(
    join(project.path, '.gemini', 'commands', 'gem.toml'),
    'prompt = "Gemini faz: $ARGUMENTS"\n',
  );

  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: '/gem arg' }));

  const args = send.mock.calls[0]?.[0].spec.args ?? [];
  expect(args.at(-1)).toBe('Gemini faz: arg');
});

test('sendMessage expands a claude project command when a handoff prefix wraps the prompt', async () => {
  const { root, send, handlers } = await setup();
  const { project, session } = await seedSession(root);
  await mkdir(join(project.path, '.claude', 'commands'), { recursive: true });
  await writeFile(
    join(project.path, '.claude', 'commands', 'minha-skill.md'),
    'Faça isto: $ARGUMENTS',
  );
  await updateSession({
    root,
    sessionId: session.id,
    patch: { handoffContext: 'Contexto anterior' },
  });

  unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: '/minha-skill arg' }));

  const last = (send.mock.calls[0]?.[0].spec.args ?? []).at(-1) ?? '';
  expect(last).toContain('Contexto anterior');
  expect(last).toContain('Faça isto: arg');
  expect(last).not.toContain('/minha-skill');
});

test('clearSession empties the transcript and resets agent memory', async () => {
  const { root, handlers } = await setup();
  const { session } = await seedRewindSession(root, handlers);

  unwrap(await handlers.clearSession({ sessionId: session.id }));

  expect(unwrap(await handlers.loadTranscript({ sessionId: session.id }))).toEqual([]);
  const stored = (await loadStore(root)).sessions?.find((item) => item.id === session.id);
  expect(stored?.providerSessionId).toBeNull();
  expect(stored?.handoffContext).toBeNull();
});

test('clearSession detaches a child session and refuses while running', async () => {
  const { root, handlers, running } = await setup();
  const { project, session: parent } = await seedSession(root);
  const child = await createSession({ root, projectId: project.id, parentId: parent.id });
  running.add(child.id);
  expect((await handlers.clearSession({ sessionId: child.id })).ok).toBe(false);
  running.delete(child.id);

  unwrap(await handlers.clearSession({ sessionId: child.id }));

  const stored = (await loadStore(root)).sessions?.find((item) => item.id === child.id);
  expect(stored?.detachedFromParent).toBe(true);
});
