import { ipcMain } from 'electron';
import { CHANNELS } from '../shared/api.js';
import type { createHandlers } from './handlers.js';
import type { SessionManager } from './sessions.js';
import { isRecord } from './validation.js';

type Handlers = ReturnType<typeof createHandlers>;

function resizeRequest(
  input: unknown,
): { sessionId: string; cols: number; rows: number } | undefined {
  if (!isRecord(input)) return undefined;
  const { sessionId, cols, rows } = input;
  if (typeof sessionId !== 'string') return undefined;
  if (typeof cols !== 'number' || typeof rows !== 'number') return undefined;
  return { sessionId, cols, rows };
}

export function registerIpc(deps: { handlers: Handlers; sessions: SessionManager }): void {
  const { handlers, sessions } = deps;
  ipcMain.handle(CHANNELS.listAccounts, () => handlers.listAccounts());
  ipcMain.handle(CHANNELS.addAccount, (_event, input: unknown) => handlers.addAccount(input));
  ipcMain.handle(CHANNELS.removeAccount, (_event, input: unknown) => handlers.removeAccount(input));
  ipcMain.handle(CHANNELS.listProjects, () => handlers.listProjects());
  ipcMain.handle(CHANNELS.pickFolder, () => handlers.pickFolder());
  ipcMain.handle(CHANNELS.bindProject, (_event, input: unknown) => handlers.bindProject(input));
  ipcMain.handle(CHANNELS.unbindProject, (_event, input: unknown) => handlers.unbindProject(input));
  ipcMain.handle(CHANNELS.openProject, (_event, input: unknown) => handlers.openProject(input));
  ipcMain.handle(CHANNELS.openLogin, (_event, input: unknown) => handlers.openLogin(input));

  ipcMain.on(CHANNELS.ptyWrite, (_event, sessionId: unknown, data: unknown) => {
    if (typeof sessionId === 'string' && typeof data === 'string') sessions.write(sessionId, data);
  });
  ipcMain.on(CHANNELS.ptyResize, (_event, input: unknown) => {
    const request = resizeRequest(input);
    if (request) sessions.resize(request);
  });
  ipcMain.on(CHANNELS.ptyClose, (_event, sessionId: unknown) => {
    if (typeof sessionId === 'string') sessions.close(sessionId);
  });
}
