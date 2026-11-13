import { afterEach, expect, test, vi } from 'vitest';
import type { AuthStatus } from '@inova/core/providers';
import type { Account, ProviderId } from '@inova/core/types';
import { createLoginFlowManager, extractAuthUrl, stripAnsi } from '../src/main/login-flow.js';
import type { SessionManager } from '../src/main/sessions.js';
import type { LoginEvent } from '../src/shared/api.js';

function makeAccount(provider: ProviderId, id = 'acc-1'): Account {
  return {
    id,
    provider,
    label: 'conta',
    homeDir: `/tmp/${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function createMockSessions() {
  let nextId = 0;
  const open = vi.fn<SessionManager['open']>(() => `login-${++nextId}`);
  const write = vi.fn<SessionManager['write']>();
  const close = vi.fn<SessionManager['close']>();
  const sessions: SessionManager = {
    open,
    write,
    resize: vi.fn(),
    close,
    closeAll: vi.fn(),
    accountsInUse: () => new Set(),
  };
  return { sessions, open, write, close };
}

afterEach(() => {
  vi.useRealTimers();
});

test('stripAnsi removes CSI, OSC, and single-char escapes', () => {
  const raw = '\u001b[32mSelect login method:\u001b[0m\r\n\u001b]0;Title\u0007\u001bM';
  expect(stripAnsi(raw)).toBe('Select login method:\r\n');
});

test('extractAuthUrl handles claude single-line URLs and wrapped agy URLs', () => {
  const claudeOutput =
    "Opening browser to sign in…\r\nIf the browser didn't open, visit: https://claude.ai/oauth/authorize?code=true&state=xyz\r\nPaste code here if prompted > ";
  expect(extractAuthUrl(claudeOutput)).toBe(
    'https://claude.ai/oauth/authorize?code=true&state=xyz',
  );

  const agyWrapped = [
    '   Please open the following URL in your browser to continue:',
    '   https://accounts.google.com/o/oauth2/v2/auth?client_id=123456',
    '   7890&redirect_uri=http%3A%2F%2Flocalhost%3A4123%2Foauth2callback',
    '   &prompt=consent',
    '',
  ].join('\r\n');
  expect(extractAuthUrl(agyWrapped)).toBe(
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=1234567890&redirect_uri=http%3A%2F%2Flocalhost%3A4123%2Foauth2callback&prompt=consent',
  );
  expect(extractAuthUrl('no url present')).toBeNull();
});

test('gemini flow answers terminal queries, auto-selects Google OAuth, polls to unlock, and closes pty', async () => {
  vi.useFakeTimers();
  const { sessions, write, close } = createMockSessions();
  const events: LoginEvent[] = [];
  const onAuthenticated = vi.fn();
  let currentStatus: AuthStatus = 'logged-out';
  const checkStatus = vi.fn(async () => currentStatus);

  const manager = createLoginFlowManager({
    sessions,
    checkStatus,
    emit: (event) => events.push(event),
    onAuthenticated,
    readTokensTimestamp: async () => 10,
    pollIntervalMs: 100,
    methodSelectDelayMs: 25,
    timeoutMs: 10_000,
  });

  const started = await manager.start({
    account: makeAccount('gemini'),
    spec: { command: 'agy', cwd: '/tmp/acc-1', env: {}, args: [] },
    file: '/usr/local/bin/agy',
    baseEnv: {},
  });
  expect(started.sessionId).toBe('login-1');
  expect(events.at(-1)).toMatchObject({ stage: 'starting', authUrl: null, codePrompt: false });

  manager.handlePtyData('login-1', '\x1b[6n\x1b[c');
  expect(write).toHaveBeenCalledWith('login-1', '\x1b[1;1R');
  expect(write).toHaveBeenCalledWith('login-1', '\x1b[?62;c');

  manager.handlePtyData(
    'login-1',
    'Select login method:\r\n> 1. Google OAuth\r\n  2. Use a Google Cloud project\r\n',
  );
  await vi.advanceTimersByTimeAsync(25);
  expect(write).toHaveBeenCalledWith('login-1', '\r');

  manager.handlePtyData(
    'login-1',
    'Visit: https://accounts.google.com/o/oauth2/v2/auth?state=abc\r\n   def\r\n',
  );
  expect(events.at(-1)).toEqual({
    sessionId: 'login-1',
    stage: 'waiting-auth',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=abcdef',
    codePrompt: false,
    message: null,
  });

  currentStatus = 'logged-in';
  await vi.advanceTimersByTimeAsync(100);

  expect(close).toHaveBeenCalledWith('login-1');
  expect(onAuthenticated).toHaveBeenCalledWith('acc-1');
  expect(events.slice(-2).map((item) => item.stage)).toEqual(['verifying', 'succeeded']);
});

test('claude flow captures auth URL + code prompt, forwards code, and fails if exit stays logged-out', async () => {
  const { sessions, write } = createMockSessions();
  const events: LoginEvent[] = [];
  let status: AuthStatus = 'logged-out';

  const manager = createLoginFlowManager({
    sessions,
    checkStatus: async () => status,
    emit: (event) => events.push(event),
  });

  const started = await manager.start({
    account: makeAccount('claude'),
    spec: { command: 'claude', cwd: '/tmp/acc-1', env: {}, args: ['auth', 'login'] },
    file: '/usr/local/bin/claude',
    baseEnv: {},
  });

  manager.handlePtyData(
    started.sessionId,
    'Opening browser to sign in…\r\nIf the browser did not open, visit: https://claude.ai/oauth/authorize?s=1\r\nPaste code here if prompted > ',
  );
  expect(events.at(-1)).toEqual({
    sessionId: started.sessionId,
    stage: 'waiting-auth',
    authUrl: 'https://claude.ai/oauth/authorize?s=1',
    codePrompt: true,
    message: null,
  });

  expect(manager.submitCode({ sessionId: started.sessionId, code: '  secret-code  ' })).toBe(true);
  expect(write).toHaveBeenCalledWith(started.sessionId, 'secret-code\r');

  await manager.handlePtyExit(started.sessionId, 1);
  expect(events.at(-1)).toEqual({
    sessionId: started.sessionId,
    stage: 'failed',
    authUrl: 'https://claude.ai/oauth/authorize?s=1',
    codePrompt: true,
    message: 'Não foi possível concluir a autenticação. Tente novamente.',
  });

  status = 'logged-in';
  const second = await manager.start({
    account: makeAccount('claude', 'acc-2'),
    spec: { command: 'claude', cwd: '/tmp/acc-2', env: {}, args: ['auth', 'login'] },
    file: '/usr/local/bin/claude',
    baseEnv: {},
  });
  await manager.handlePtyExit(second.sessionId, 0);
  expect(events.at(-1)).toMatchObject({ sessionId: second.sessionId, stage: 'succeeded' });
});

test('cancel closes pty and emits canceled without failing', async () => {
  const { sessions, close } = createMockSessions();
  const events: LoginEvent[] = [];

  const manager = createLoginFlowManager({
    sessions,
    checkStatus: async () => 'logged-out',
    emit: (event) => events.push(event),
  });

  const started = await manager.start({
    account: makeAccount('codex'),
    spec: { command: 'codex', cwd: '/tmp/acc-1', env: {}, args: ['login'] },
    file: '/usr/local/bin/codex',
    baseEnv: {},
  });

  manager.cancel(started.sessionId);
  expect(close).toHaveBeenCalledWith(started.sessionId);
  expect(events.at(-1)).toMatchObject({ sessionId: started.sessionId, stage: 'canceled' });

  await manager.handlePtyExit(started.sessionId, 130);
  expect(events.filter((item) => item.stage === 'canceled')).toHaveLength(1);
});

test('timeout closes pty and emits failed', async () => {
  vi.useFakeTimers();
  const { sessions, close } = createMockSessions();
  const events: LoginEvent[] = [];

  const manager = createLoginFlowManager({
    sessions,
    checkStatus: async () => 'logged-out',
    emit: (event) => events.push(event),
    timeoutMs: 500,
  });

  const started = await manager.start({
    account: makeAccount('claude'),
    spec: { command: 'claude', cwd: '/tmp/acc-1', env: {}, args: ['auth', 'login'] },
    file: '/usr/local/bin/claude',
    baseEnv: {},
  });

  await vi.advanceTimersByTimeAsync(500);
  expect(close).toHaveBeenCalledWith(started.sessionId);
  expect(events.at(-1)).toMatchObject({
    sessionId: started.sessionId,
    stage: 'failed',
    message: 'Tempo limite da autenticação excedido. Tente novamente.',
  });
});
