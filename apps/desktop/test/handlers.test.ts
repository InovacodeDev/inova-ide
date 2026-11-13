import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { addAccount } from '@inova/core/accounts';
import type { ChatEvent } from '@inova/core/chat-types';
import { bindProject } from '@inova/core/projects';
import type { CommandRunner } from '@inova/core/providers';
import { createSession, updateSession } from '@inova/core/sessions';
import { loadStore } from '@inova/core/store';
import type { Store } from '@inova/core/types';
import type { UsageDeps } from '@inova/core/usage';
import type { ChatRunner } from '../src/main/chat.js';
import { createHandlers, isExternalWebUrl } from '../src/main/handlers.js';
import type { SessionManager } from '../src/main/sessions.js';
import type { LoginEvent, Result } from '../src/shared/api.js';

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
    await writeFile(join(bin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await writeFile(join(bin, 'agy'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  const inUse = new Set<string>();
  const running = new Set<string>();
  const chatInUse = new Set<string>();
  const emitted: { sessionId: string; event: ChatEvent }[] = [];
  const loginEvents: LoginEvent[] = [];
  const send = vi.fn<ChatRunner['send']>();
  const cancel = vi.fn<ChatRunner['cancel']>();
  const chat: ChatRunner = {
    send,
    cancel,
    isRunning: (sessionId) => running.has(sessionId),
    accountsInUse: () => chatInUse,
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
  const baseEnv = { PATH: bin, TERM: 'xterm-256color', ANTHROPIC_API_KEY: 'fake-key' };
  const handlers = createHandlers({
    root,
    runner: { run },
    sessions,
    chat,
    usageDeps: {
      platform: 'linux',
      runner: { run },
      fetch,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    },
    emit: (sessionId, event) => emitted.push({ sessionId, event }),
    emitLogin: (event) => loginEvents.push(event),
    baseEnv: async () => baseEnv,
    pickFolder: async () => '/picked',
  });
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
    emitted,
    loginEvents,
    send,
    cancel,
    fetch,
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
