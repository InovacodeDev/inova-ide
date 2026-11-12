import { beforeEach, expect, test, vi } from 'vitest';
import type { createHandlers } from '../src/main/handlers.js';
import { isAppUrl, registerIpc } from '../src/main/ipc.js';
import type { SessionManager } from '../src/main/sessions.js';

type Listener = (event: unknown, ...args: unknown[]) => unknown;

const electron = vi.hoisted(() => ({
  invokes: new Map<string, Listener>(),
  sends: new Map<string, Listener>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: Listener) => electron.invokes.set(channel, listener),
    on: (channel: string, listener: Listener) => electron.sends.set(channel, listener),
  },
}));

const APP = 'file:///app/out/renderer/index.html';
const trusted = { senderFrame: { url: APP } };
const foreign = { senderFrame: { url: 'file:///tmp/evil.html' } };

function setup() {
  const methods = ['addAccount', 'removeAccount', 'bindProject', 'unbindProject'] as const;
  const handlers = Object.fromEntries(
    [...methods, 'openProject', 'openLogin', 'listAccounts', 'listProjects', 'pickFolder'].map(
      (name) => [name, vi.fn(async () => ({ ok: true, value: name }))],
    ),
  );
  const sessions = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
  registerIpc({
    handlers: handlers as unknown as ReturnType<typeof createHandlers>,
    sessions: sessions as unknown as SessionManager,
    allowedOrigin: APP,
  });
  return { handlers, sessions };
}

function invoke(channel: string, event: unknown, ...args: unknown[]): unknown {
  const listener = electron.invokes.get(channel);
  if (!listener) throw new Error(`no handler for ${channel}`);
  return listener(event, ...args);
}

function send(channel: string, event: unknown, ...args: unknown[]): void {
  const listener = electron.sends.get(channel);
  if (!listener) throw new Error(`no listener for ${channel}`);
  listener(event, ...args);
}

beforeEach(() => {
  electron.invokes.clear();
  electron.sends.clear();
});

test('a trusted invoke reaches the handler with the payload only', async () => {
  const { handlers } = setup();
  const input = { provider: 'claude', label: 'a' };
  await expect(invoke('inova:addAccount', trusted, input)).resolves.toEqual({
    ok: true,
    value: 'addAccount',
  });
  expect(handlers['addAccount']).toHaveBeenCalledWith(input);
});

test('invokes from a foreign or unknown sender are rejected', async () => {
  const { handlers } = setup();
  for (const event of [foreign, { senderFrame: null }, {}]) {
    for (const channel of electron.invokes.keys()) {
      await expect(invoke(channel, event, {})).rejects.toThrow('Remetente não autorizado.');
    }
  }
  for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
});

test('pty messages from a foreign sender are ignored', () => {
  const { sessions } = setup();
  send('inova:pty:write', foreign, 's', 'ls');
  send('inova:pty:resize', { senderFrame: null }, { sessionId: 's', cols: 80, rows: 24 });
  send('inova:pty:close', {}, 's');
  expect(sessions.write).not.toHaveBeenCalled();
  expect(sessions.resize).not.toHaveBeenCalled();
  expect(sessions.close).not.toHaveBeenCalled();
});

test('valid pty payloads are forwarded', () => {
  const { sessions } = setup();
  send('inova:pty:write', trusted, 's', 'ls');
  send('inova:pty:resize', trusted, { sessionId: 's', cols: 80, rows: 24 });
  send('inova:pty:close', trusted, 's');
  expect(sessions.write).toHaveBeenCalledWith('s', 'ls');
  expect(sessions.resize).toHaveBeenCalledWith({ sessionId: 's', cols: 80, rows: 24 });
  expect(sessions.close).toHaveBeenCalledWith('s');
});

test('wrong-typed pty payloads are dropped', () => {
  const { sessions } = setup();
  send('inova:pty:write', trusted, 1, 'x');
  send('inova:pty:write', trusted, 's', 5);
  send('inova:pty:write', trusted);
  send('inova:pty:close', trusted, 42);
  for (const input of [
    null,
    'x',
    [],
    { sessionId: 's', cols: '80', rows: 24 },
    { cols: 1, rows: 1 },
  ]) {
    send('inova:pty:resize', trusted, input);
  }
  expect(sessions.write).not.toHaveBeenCalled();
  expect(sessions.close).not.toHaveBeenCalled();
  expect(sessions.resize).not.toHaveBeenCalled();
});

test('isAppUrl matches the app url and its sub-paths, query or hash only', () => {
  const dev = 'http://localhost:5173';
  expect(isAppUrl('http://localhost:5173/', dev)).toBe(true);
  expect(isAppUrl('http://localhost:5173', dev)).toBe(true);
  expect(isAppUrl('http://localhost:5173/?x=1#y', dev)).toBe(true);
  expect(isAppUrl('http://localhost:5173.evil.com/', dev)).toBe(false);
  expect(isAppUrl('http://localhost:51730/', dev)).toBe(false);
  expect(isAppUrl(`${APP}#top`, APP)).toBe(true);
  expect(isAppUrl('file:///app/out/renderer/other.html', APP)).toBe(false);
  expect(isAppUrl(undefined, APP)).toBe(false);
});
