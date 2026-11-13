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
  webUtils: { getPathForFile: (file: { name: string }) => `/abs/${file.name}` },
}));

async function loadApi(): Promise<InovaApi> {
  await import('../src/preload/index.js');
  return electron.exposed.get('inova') as InovaApi;
}

test('getPathForFile resolves the dropped file path through webUtils', async () => {
  const api = await loadApi();
  expect(api.getPathForFile({ name: 'a.txt' } as File)).toBe('/abs/a.txt');
});

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
  void api.getWorktreeStatus({ sessionId: 's' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:getWorktreeStatus', { sessionId: 's' });
  void api.applyWorktree({ sessionId: 's' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:applyWorktree', { sessionId: 's' });
  void api.restoreCheckpoint({ sessionId: 's', ref: 'refs/inova/checkpoints/s/1' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:restoreCheckpoint', {
    sessionId: 's',
    ref: 'refs/inova/checkpoints/s/1',
  });
  void api.detectProjectChecks({ projectId: 'p' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:detectProjectChecks', { projectId: 'p' });
  void api.updateProjectVerification({ projectId: 'p', autoVerify: true });
  expect(electron.invoke).toHaveBeenCalledWith('inova:updateProjectVerification', {
    projectId: 'p',
    autoVerify: true,
  });
  void api.runVerification({ sessionId: 's' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:runVerification', { sessionId: 's' });
  void api.enqueueTurn({ sessionId: 's', prompt: 'oi' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:enqueueTurn', {
    sessionId: 's',
    prompt: 'oi',
  });
  void api.cancelQueuedTurn({ turnId: 't1' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:cancelQueuedTurn', { turnId: 't1' });
  void api.listTurnQueue();
  expect(electron.invoke).toHaveBeenCalledWith('inova:listTurnQueue');
  void api.switchSessionAccount({ sessionId: 's', accountId: 'a2' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:switchSessionAccount', {
    sessionId: 's',
    accountId: 'a2',
  });
  void api.handoffSession({ sessionId: 's', targetAccountId: 'a2' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:handoffSession', {
    sessionId: 's',
    targetAccountId: 'a2',
  });
  void api.forkSession({ sessionId: 's', turnIndex: 0 });
  expect(electron.invoke).toHaveBeenCalledWith('inova:forkSession', {
    sessionId: 's',
    turnIndex: 0,
  });
  void api.listInbox();
  expect(electron.invoke).toHaveBeenCalledWith('inova:listInbox');
  void api.markInboxRead({ sessionId: 's' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:markInboxRead', { sessionId: 's' });
  void api.clearReadInbox();
  expect(electron.invoke).toHaveBeenCalledWith('inova:clearReadInbox');
  void api.startComparison({
    projectId: 'p',
    prompt: 'oi',
    leftAccountId: 'a1',
    rightAccountId: 'a2',
  });
  expect(electron.invoke).toHaveBeenCalledWith('inova:startComparison', {
    projectId: 'p',
    prompt: 'oi',
    leftAccountId: 'a1',
    rightAccountId: 'a2',
  });
  void api.getComparisonDiff({ groupId: 'g1' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:getComparisonDiff', { groupId: 'g1' });
  void api.resolveComparison({ groupId: 'g1', winner: 'right', cleanupWorktrees: true });
  expect(electron.invoke).toHaveBeenCalledWith('inova:resolveComparison', {
    groupId: 'g1',
    winner: 'right',
    cleanupWorktrees: true,
  });
  void api.previewProfileSync({ projectId: 'p' });
  expect(electron.invoke).toHaveBeenCalledWith('inova:previewProfileSync', { projectId: 'p' });
  void api.applyProfileSync({ projectId: 'p', approvedIds: ['mcp:a1'] });
  expect(electron.invoke).toHaveBeenCalledWith('inova:applyProfileSync', {
    projectId: 'p',
    approvedIds: ['mcp:a1'],
  });
});
