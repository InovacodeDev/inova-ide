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

test('onLoginEvent delivers only the payload and unsubscribes the exact listener', async () => {
  const api = await loadApi();
  const callback = vi.fn();
  const unsubscribe = api.onLoginEvent(callback);

  const [channel, listener] = electron.on.mock.calls[0] ?? [];
  expect(channel).toBe('inova:login:event');
  const event = {
    sessionId: 's',
    stage: 'waiting-auth',
    authUrl: 'https://example.com',
    codePrompt: false,
    message: null,
  };
  listener?.({ sender: 'secret' }, event);
  expect(callback).toHaveBeenCalledWith(event);

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

test('login calls go through invoke and send channels and pty/openLogin are absent', async () => {
  const api = await loadApi();
  void api.startLogin({ accountLabel: 'pessoal' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:startLogin', { accountLabel: 'pessoal' });
  void api.submitLoginCode({ sessionId: 's', code: 'abc' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:submitLoginCode', {
    sessionId: 's',
    code: 'abc',
  });
  api.cancelLogin('s');
  expect(electron.send).toHaveBeenCalledWith('inova:cancelLogin', 's');
  expect('openLogin' in api).toBe(false);
  expect('ptyWrite' in api).toBe(false);
  expect('ptyResize' in api).toBe(false);
  expect('ptyClose' in api).toBe(false);
  expect('onPtyData' in api).toBe(false);
  expect('onPtyExit' in api).toBe(false);
  void api.listAccounts();
  expect(electron.invoke).toHaveBeenCalledWith('inova:listAccounts');
  void api.listModels({ accountLabel: 'pessoal' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:listModels', { accountLabel: 'pessoal' });
  void api.searchFiles({ projectId: 'p', query: 'app' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:searchFiles', {
    projectId: 'p',
    query: 'app',
  });
  void api.listCommands({ projectId: 'p' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:listCommands', { projectId: 'p' });
  void api.getDefaultModes();
  expect(electron.invoke).toHaveBeenCalledWith('inova:getDefaultModes');
  void api.setDefaultMode({ provider: 'claude', mode: 'plan' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:setDefaultMode', {
    provider: 'claude',
    mode: 'plan',
  });
});
