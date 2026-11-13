import { ipcMain } from 'electron';
import { CHANNELS } from '../shared/api.js';
import type { createHandlers } from './handlers.js';
import type { VoiceHandlers } from './voice.js';

type Handlers = ReturnType<typeof createHandlers>;
type SenderEvent = { senderFrame?: { url: string } | null };

export function isAppUrl(url: string | undefined, appUrl: string): boolean {
  if (url === undefined) return false;
  return url === appUrl || ['/', '?', '#'].some((separator) => url.startsWith(appUrl + separator));
}

export function registerIpc(deps: {
  handlers: Handlers;
  voice: VoiceHandlers;
  allowedOrigin: string;
}): void {
  const { handlers, voice, allowedOrigin } = deps;
  const isTrusted = (event: SenderEvent): boolean =>
    isAppUrl(event.senderFrame?.url, allowedOrigin);

  const handle = (channel: string, run: (input: unknown) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      if (!isTrusted(event)) throw new Error('Remetente não autorizado.');
      return run(input);
    });
  };
  const listen = (channel: string, run: (...args: unknown[]) => void): void => {
    ipcMain.on(channel, (event, ...args: unknown[]) => {
      if (isTrusted(event)) run(...args);
    });
  };

  handle(CHANNELS.listAccounts, () => handlers.listAccounts());
  handle(CHANNELS.addAccount, (input) => handlers.addAccount(input));
  handle(CHANNELS.removeAccount, (input) => handlers.removeAccount(input));
  handle(CHANNELS.listProjects, () => handlers.listProjects());
  handle(CHANNELS.pickFolder, () => handlers.pickFolder());
  handle(CHANNELS.bindProject, (input) => handlers.bindProject(input));
  handle(CHANNELS.unbindProject, (input) => handlers.unbindProject(input));
  handle(CHANNELS.listSessions, (input) => handlers.listSessions(input));
  handle(CHANNELS.createSession, (input) => handlers.createSession(input));
  handle(CHANNELS.updateSession, (input) => handlers.updateSession(input));
  handle(CHANNELS.getDefaultModes, () => handlers.getDefaultModes());
  handle(CHANNELS.setDefaultMode, (input) => handlers.setDefaultMode(input));
  handle(CHANNELS.deleteSession, (input) => handlers.deleteSession(input));
  handle(CHANNELS.getWorktreeStatus, (input) => handlers.getWorktreeStatus(input));
  handle(CHANNELS.applyWorktree, (input) => handlers.applyWorktree(input));
  handle(CHANNELS.restoreCheckpoint, (input) => handlers.restoreCheckpoint(input));
  handle(CHANNELS.detectProjectChecks, (input) => handlers.detectProjectChecks(input));
  handle(CHANNELS.updateProjectVerification, (input) => handlers.updateProjectVerification(input));
  handle(CHANNELS.runVerification, (input) => handlers.runVerification(input));
  handle(CHANNELS.getWorkspace, () => handlers.getWorkspace());
  handle(CHANNELS.saveWorkspace, (input) => handlers.saveWorkspace(input));
  handle(CHANNELS.loadTranscript, (input) => handlers.loadTranscript(input));
  handle(CHANNELS.sendMessage, (input) => handlers.sendMessage(input));
  handle(CHANNELS.enqueueTurn, (input) => handlers.enqueueTurn(input));
  handle(CHANNELS.cancelQueuedTurn, (input) => handlers.cancelQueuedTurn(input));
  handle(CHANNELS.listTurnQueue, () => handlers.listTurnQueue());
  handle(CHANNELS.switchSessionAccount, (input) => handlers.switchSessionAccount(input));
  handle(CHANNELS.handoffSession, (input) => handlers.handoffSession(input));
  handle(CHANNELS.forkSession, (input) => handlers.forkSession(input));
  handle(CHANNELS.listInbox, () => handlers.listInbox());
  handle(CHANNELS.markInboxRead, (input) => handlers.markInboxRead(input));
  handle(CHANNELS.clearReadInbox, () => handlers.clearReadInbox());
  handle(CHANNELS.getUsage, (input) => handlers.getUsage(input));
  handle(CHANNELS.listModels, (input) => handlers.listModels(input));
  handle(CHANNELS.searchFiles, (input) => handlers.searchFiles(input));
  handle(CHANNELS.listCommands, (input) => handlers.listCommands(input));
  handle(CHANNELS.startComparison, (input) => handlers.startComparison(input));
  handle(CHANNELS.getComparisonDiff, (input) => handlers.getComparisonDiff(input));
  handle(CHANNELS.resolveComparison, (input) => handlers.resolveComparison(input));
  handle(CHANNELS.previewProfileSync, (input) => handlers.previewProfileSync(input));
  handle(CHANNELS.applyProfileSync, (input) => handlers.applyProfileSync(input));
  handle(CHANNELS.startLogin, (input) => handlers.startLogin(input));
  handle(CHANNELS.submitLoginCode, (input) => handlers.submitLoginCode(input));
  handle(CHANNELS.getVoiceStatus, () => voice.getVoiceStatus());
  handle(CHANNELS.downloadVoiceModel, () => voice.downloadVoiceModel());
  handle(CHANNELS.transcribeAudio, (input) => voice.transcribeAudio(input));

  listen(CHANNELS.cancelTurn, (sessionId) => {
    if (typeof sessionId === 'string') handlers.cancelTurn(sessionId);
  });
  listen(CHANNELS.reportUiFocus, (payload) => {
    handlers.reportUiFocus(payload);
  });
  listen(CHANNELS.cancelLogin, (sessionId) => {
    if (typeof sessionId === 'string') handlers.cancelLogin(sessionId);
  });
}
