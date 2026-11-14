import { beforeEach, expect, test, vi } from 'vitest';
import type { createHandlers } from '../src/main/handlers.js';
import { isAppUrl, registerIpc } from '../src/main/ipc.js';
import type { VoiceHandlers } from '../src/main/voice.js';

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
    [
      ...methods,
      'listSessions',
      'createSession',
      'updateSession',
      'getDefaultModes',
      'setDefaultMode',
      'getSettings',
      'updateSettings',
      'sendTestNotification',
      'openNotificationSettings',
      'openDataFolder',
      'deleteSession',
      'getWorktreeStatus',
      'applyWorktree',
      'restoreCheckpoint',
      'detectProjectChecks',
      'updateProjectVerification',
      'runVerification',
      'getWorkspace',
      'saveWorkspace',
      'loadTranscript',
      'sendMessage',
      'enqueueTurn',
      'cancelQueuedTurn',
      'listTurnQueue',
      'switchSessionAccount',
      'handoffSession',
      'forkSession',
      'rewindSession',
      'listExternalSessions',
      'importSessions',
      'listInbox',
      'markInboxRead',
      'clearReadInbox',
      'getUsage',
      'listModels',
      'startLogin',
      'submitLoginCode',
      'listAccounts',
      'listProjects',
      'pickFolder',
      'pickAttachments',
      'searchFiles',
      'listCommands',
      'startComparison',
      'getComparisonDiff',
      'resolveComparison',
      'previewProfileSync',
      'applyProfileSync',
    ].map((name) => [name, vi.fn(async () => ({ ok: true, value: name }))]),
  );
  handlers['cancelTurn'] = vi.fn();
  handlers['cancelLogin'] = vi.fn();
  handlers['reportUiFocus'] = vi.fn();
  const voice = {
    getVoiceStatus: vi.fn(async () => ({ ok: true as const, value: 'getVoiceStatus' })),
    downloadVoiceModel: vi.fn(async () => ({ ok: true as const, value: 'downloadVoiceModel' })),
    deleteVoiceModel: vi.fn(async () => ({ ok: true as const, value: 'deleteVoiceModel' })),
    transcribeAudio: vi.fn(async () => ({ ok: true as const, value: 'transcribeAudio' })),
  };
  registerIpc({
    handlers: handlers as unknown as ReturnType<typeof createHandlers>,
    voice: voice as unknown as VoiceHandlers,
    allowedOrigin: APP,
  });
  return { handlers, voice };
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
  const { handlers, voice } = setup();
  for (const event of [foreign, { senderFrame: null }, {}]) {
    for (const channel of electron.invokes.keys()) {
      await expect(invoke(channel, event, {})).rejects.toThrow('Remetente não autorizado.');
    }
  }
  for (const handler of [...Object.values(handlers), ...Object.values(voice)]) {
    expect(handler).not.toHaveBeenCalled();
  }
});

test('voice invokes reach the voice handlers', async () => {
  const { voice } = setup();
  const input = { pcm: new Uint8Array(2), final: true, language: 'pt', hints: [] };
  await invoke('inova:transcribeAudio', trusted, input);
  expect(voice.transcribeAudio).toHaveBeenCalledWith(input);
  await invoke('inova:getVoiceStatus', trusted);
  await invoke('inova:downloadVoiceModel', trusted);
  expect(voice.getVoiceStatus).toHaveBeenCalledOnce();
  expect(voice.downloadVoiceModel).toHaveBeenLastCalledWith(undefined);
  await invoke('inova:downloadVoiceModel', trusted, { modelId: 'base' });
  expect(voice.downloadVoiceModel).toHaveBeenLastCalledWith({ modelId: 'base' });
  await invoke('inova:deleteVoiceModel', trusted, { modelId: 'base' });
  expect(voice.deleteVoiceModel).toHaveBeenCalledWith({ modelId: 'base' });
});

test('terminal pty and openLogin channels are not registered', () => {
  setup();
  expect(electron.invokes.has('inova:openLogin')).toBe(false);
  expect(electron.sends.has('inova:pty:write')).toBe(false);
  expect(electron.sends.has('inova:pty:resize')).toBe(false);
  expect(electron.sends.has('inova:pty:close')).toBe(false);
});

test('login invokes and cancelLogin enforce trusted sender and input types', async () => {
  const { handlers } = setup();
  await invoke('inova:startLogin', trusted, { accountLabel: 'pessoal' });
  expect(handlers['startLogin']).toHaveBeenCalledWith({ accountLabel: 'pessoal' });
  await invoke('inova:submitLoginCode', trusted, { sessionId: 's', code: 'abc' });
  expect(handlers['submitLoginCode']).toHaveBeenCalledWith({ sessionId: 's', code: 'abc' });

  send('inova:cancelLogin', foreign, 's');
  send('inova:cancelLogin', trusted, 42);
  expect(handlers['cancelLogin']).not.toHaveBeenCalled();
  send('inova:cancelLogin', trusted, 's');
  expect(handlers['cancelLogin']).toHaveBeenCalledWith('s');
});

test('chat invokes reach their handlers and openProject is gone', async () => {
  const { handlers } = setup();
  const input = { sessionId: 's', prompt: 'oi' };
  await invoke('inova:sendMessage', trusted, input);
  expect(handlers['sendMessage']).toHaveBeenCalledWith(input);
  await invoke('inova:searchFiles', trusted, { projectId: 'p', query: 'a' });
  expect(handlers['searchFiles']).toHaveBeenCalledWith({ projectId: 'p', query: 'a' });
  await invoke('inova:listCommands', trusted, { projectId: 'p' });
  expect(handlers['listCommands']).toHaveBeenCalledWith({ projectId: 'p' });
  for (const name of ['listSessions', 'createSession', 'updateSession', 'deleteSession']) {
    await invoke(`inova:${name}`, trusted, input);
    expect(handlers[name]).toHaveBeenCalledWith(input);
  }
  await invoke('inova:saveWorkspace', trusted, input);
  expect(handlers['saveWorkspace']).toHaveBeenCalledWith(input);
  await invoke('inova:getWorkspace', trusted);
  expect(handlers['getWorkspace']).toHaveBeenCalledWith();
  expect(electron.invokes.has('inova:renameSession')).toBe(false);
  await invoke('inova:loadTranscript', trusted, input);
  await invoke('inova:getUsage', trusted, input);
  await invoke('inova:listModels', trusted, input);
  await invoke('inova:getDefaultModes', trusted);
  await invoke('inova:setDefaultMode', trusted, { provider: 'claude', mode: 'plan' });
  await invoke('inova:getSettings', trusted);
  await invoke('inova:updateSettings', trusted, { voice: { language: 'pt' } });
  await invoke('inova:sendTestNotification', trusted);
  await invoke('inova:openNotificationSettings', trusted);
  await invoke('inova:openDataFolder', trusted);
  await invoke('inova:getWorktreeStatus', trusted, { sessionId: 's' });
  await invoke('inova:applyWorktree', trusted, { sessionId: 's' });
  await invoke('inova:restoreCheckpoint', trusted, {
    sessionId: 's',
    ref: 'refs/inova/checkpoints/s/1',
  });
  await invoke('inova:detectProjectChecks', trusted, { projectId: 'p' });
  await invoke('inova:updateProjectVerification', trusted, { projectId: 'p', autoVerify: true });
  await invoke('inova:runVerification', trusted, { sessionId: 's' });
  await invoke('inova:enqueueTurn', trusted, input);
  await invoke('inova:cancelQueuedTurn', trusted, { turnId: 't1' });
  await invoke('inova:listTurnQueue', trusted);
  await invoke('inova:switchSessionAccount', trusted, { sessionId: 's', accountId: 'a2' });
  await invoke('inova:handoffSession', trusted, { sessionId: 's', targetAccountId: 'a2' });
  await invoke('inova:forkSession', trusted, { sessionId: 's', turnIndex: 0 });
  await invoke('inova:rewindSession', trusted, { sessionId: 's', turnIndex: 0 });
  await invoke('inova:listInbox', trusted);
  await invoke('inova:markInboxRead', trusted, { sessionId: 's' });
  await invoke('inova:clearReadInbox', trusted);
  await invoke('inova:startComparison', trusted, {
    projectId: 'p',
    prompt: 'oi',
    leftAccountId: 'a1',
    rightAccountId: 'a2',
  });
  await invoke('inova:getComparisonDiff', trusted, { groupId: 'g1' });
  await invoke('inova:resolveComparison', trusted, { groupId: 'g1', winner: 'left' });
  await invoke('inova:previewProfileSync', trusted, { projectId: 'p' });
  await invoke('inova:applyProfileSync', trusted, { projectId: 'p', approvedIds: ['x'] });
  expect(handlers['loadTranscript']).toHaveBeenCalledWith(input);
  expect(handlers['getUsage']).toHaveBeenCalledWith(input);
  expect(handlers['listModels']).toHaveBeenCalledWith(input);
  expect(handlers['getDefaultModes']).toHaveBeenCalledWith();
  expect(handlers['setDefaultMode']).toHaveBeenCalledWith({ provider: 'claude', mode: 'plan' });
  expect(handlers['getSettings']).toHaveBeenCalledWith();
  expect(handlers['updateSettings']).toHaveBeenCalledWith({ voice: { language: 'pt' } });
  expect(handlers['sendTestNotification']).toHaveBeenCalledWith();
  expect(handlers['openNotificationSettings']).toHaveBeenCalledWith();
  expect(handlers['openDataFolder']).toHaveBeenCalledWith();
  expect(handlers['getWorktreeStatus']).toHaveBeenCalledWith({ sessionId: 's' });
  expect(handlers['applyWorktree']).toHaveBeenCalledWith({ sessionId: 's' });
  expect(handlers['restoreCheckpoint']).toHaveBeenCalledWith({
    sessionId: 's',
    ref: 'refs/inova/checkpoints/s/1',
  });
  expect(handlers['detectProjectChecks']).toHaveBeenCalledWith({ projectId: 'p' });
  expect(handlers['updateProjectVerification']).toHaveBeenCalledWith({
    projectId: 'p',
    autoVerify: true,
  });
  expect(handlers['runVerification']).toHaveBeenCalledWith({ sessionId: 's' });
  expect(electron.invokes.has('inova:openProject')).toBe(false);
});

test('cancelTurn is forwarded only from a trusted sender with a string id', () => {
  const { handlers } = setup();
  send('inova:cancelTurn', foreign, 's');
  send('inova:cancelTurn', trusted, 42);
  expect(handlers['cancelTurn']).not.toHaveBeenCalled();
  send('inova:cancelTurn', trusted, 's');
  expect(handlers['cancelTurn']).toHaveBeenCalledWith('s');
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
