import { ipcMain } from 'electron';
import { CHANNELS } from '../shared/api.js';
import type { createHandlers } from './handlers.js';
import type { SessionManager } from './sessions.js';
import { isRecord } from './validation.js';

type Handlers = ReturnType<typeof createHandlers>;
type SenderEvent = { senderFrame?: { url: string } | null };

export function isAppUrl(url: string | undefined, appUrl: string): boolean {
  if (url === undefined) return false;
  return url === appUrl || ['/', '?', '#'].some((separator) => url.startsWith(appUrl + separator));
}

function resizeRequest(
  input: unknown,
): { sessionId: string; cols: number; rows: number } | undefined {
  if (!isRecord(input)) return undefined;
  const { sessionId, cols, rows } = input;
  if (typeof sessionId !== 'string') return undefined;
  if (typeof cols !== 'number' || typeof rows !== 'number') return undefined;
  return { sessionId, cols, rows };
}

export function registerIpc(deps: {
  handlers: Handlers;
  sessions: SessionManager;
  allowedOrigin: string;
}): void {
  const { handlers, sessions, allowedOrigin } = deps;
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
  handle(CHANNELS.deleteSession, (input) => handlers.deleteSession(input));
  handle(CHANNELS.getWorkspace, () => handlers.getWorkspace());
  handle(CHANNELS.saveWorkspace, (input) => handlers.saveWorkspace(input));
  handle(CHANNELS.loadTranscript, (input) => handlers.loadTranscript(input));
  handle(CHANNELS.sendMessage, (input) => handlers.sendMessage(input));
  handle(CHANNELS.getUsage, (input) => handlers.getUsage(input));
  handle(CHANNELS.openLogin, (input) => handlers.openLogin(input));

  listen(CHANNELS.cancelTurn, (sessionId) => {
    if (typeof sessionId === 'string') handlers.cancelTurn(sessionId);
  });
  listen(CHANNELS.ptyWrite, (sessionId, data) => {
    if (typeof sessionId === 'string' && typeof data === 'string') sessions.write(sessionId, data);
  });
  listen(CHANNELS.ptyResize, (input) => {
    const request = resizeRequest(input);
    if (request) sessions.resize(request);
  });
  listen(CHANNELS.ptyClose, (sessionId) => {
    if (typeof sessionId !== 'string') return;
    try {
      sessions.close(sessionId);
    } catch (error: unknown) {
      console.error(`inova: failed to close session ${sessionId}`, error);
    }
  });
}
