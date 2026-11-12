import { expect, test, vi } from 'vitest';
import type { InovaApi } from '../src/shared/api.js';

type Listener = (event: unknown, payload: unknown) => void;

const electron = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  on: vi.fn<(channel: string, listener: Listener) => void>(),
  removeListener: vi.fn<(channel: string, listener: Listener) => void>(),
  send: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => electron.exposed.set(name, api),
  },
  ipcRenderer: {
    on: electron.on,
    removeListener: electron.removeListener,
    send: electron.send,
    invoke: electron.invoke,
  },
}));

async function loadApi(): Promise<InovaApi> {
  await import('../src/preload/index.js');
  return electron.exposed.get('inova') as InovaApi;
}

test('onPtyData delivers only the payload and unsubscribes the exact listener', async () => {
  const api = await loadApi();
  const callback = vi.fn();
  const unsubscribe = api.onPtyData(callback);

  const [channel, listener] = electron.on.mock.calls[0] ?? [];
  expect(channel).toBe('inova:pty:data');
  listener?.({ sender: 'secret' }, { sessionId: 's', data: 'x' });
  expect(callback).toHaveBeenCalledWith({ sessionId: 's', data: 'x' });

  unsubscribe();
  expect(electron.removeListener).toHaveBeenCalledWith(channel, listener);
});

test('onChatEvent delivers only the payload and unsubscribes the exact listener', async () => {
  const api = await loadApi();
  electron.on.mockClear();
  const callback = vi.fn();
  const unsubscribe = api.onChatEvent(callback);

  const [channel, listener] = electron.on.mock.calls[0] ?? [];
  expect(channel).toBe('inova:chat:event');
  listener?.({ sender: 'secret' }, { sessionId: 's', event: { kind: 'session' } });
  expect(callback).toHaveBeenCalledWith({ sessionId: 's', event: { kind: 'session' } });

  unsubscribe();
  expect(electron.removeListener).toHaveBeenCalledWith(channel, listener);
});

test('chat calls go through invoke and send channels', async () => {
  const api = await loadApi();
  void api.sendMessage({ sessionId: 's', prompt: 'oi' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:sendMessage', {
    sessionId: 's',
    prompt: 'oi',
  });
  api.cancelTurn('s');
  expect(electron.send).toHaveBeenCalledWith('inova:cancelTurn', 's');
  expect('openProject' in api).toBe(false);
});

test('session update and workspace calls use their channels', async () => {
  const api = await loadApi();
  void api.updateSession({ sessionId: 's', archived: true });
  expect(electron.invoke).toHaveBeenCalledWith('inova:updateSession', {
    sessionId: 's',
    archived: true,
  });
  void api.getWorkspace();
  expect(electron.invoke).toHaveBeenCalledWith('inova:getWorkspace');
  const workspace = { openSessionIds: ['s'], activeSessionId: 's' };
  void api.saveWorkspace(workspace);
  expect(electron.invoke).toHaveBeenCalledWith('inova:saveWorkspace', workspace);
  expect('renameSession' in api).toBe(false);
});

test('pty calls go through send and invoke channels', async () => {
  const api = await loadApi();
  api.ptyWrite('s', 'ls');
  expect(electron.send).toHaveBeenCalledWith('inova:pty:write', 's', 'ls');
  void api.listAccounts();
  expect(electron.invoke).toHaveBeenCalledWith('inova:listAccounts');
});
