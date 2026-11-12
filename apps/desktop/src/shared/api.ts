import type { AuthStatus } from '@inova/core/providers';
import type { ChatEvent, UsageSnapshot } from '@inova/core/chat-types';
import type { ProviderId, Session } from '@inova/core/types';

export type SessionView = Session;

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export interface AccountView {
  id: string;
  label: string;
  provider: ProviderId;
  status: AuthStatus;
}

export interface ProjectView {
  id: string;
  path: string;
  accountLabel: string;
  provider: ProviderId;
}

export interface OpenedSession {
  sessionId: string;
  title: string;
}

export interface InovaApi {
  listAccounts(): Promise<Result<AccountView[]>>;
  addAccount(input: { provider: string; label: string }): Promise<Result<AccountView>>;
  removeAccount(input: { label: string; force: boolean }): Promise<Result<null>>;
  listProjects(): Promise<Result<ProjectView[]>>;
  pickFolder(): Promise<string | null>;
  bindProject(input: { path: string; accountLabel: string }): Promise<Result<ProjectView>>;
  unbindProject(input: { path: string }): Promise<Result<null>>;
  listSessions(input: { projectId: string }): Promise<Result<SessionView[]>>;
  createSession(input: {
    projectId: string;
    parentId?: string | null;
  }): Promise<Result<SessionView>>;
  renameSession(input: { sessionId: string; title: string }): Promise<Result<SessionView>>;
  deleteSession(input: { sessionId: string }): Promise<Result<null>>;
  loadTranscript(input: { sessionId: string }): Promise<Result<ChatEvent[]>>;
  sendMessage(input: { sessionId: string; prompt: string }): Promise<Result<null>>;
  cancelTurn(sessionId: string): void;
  getUsage(input: { accountLabel: string }): Promise<Result<UsageSnapshot>>;
  onChatEvent(cb: (e: { sessionId: string; event: ChatEvent }) => void): () => void;
  openLogin(input: {
    accountLabel: string;
    cols: number;
    rows: number;
  }): Promise<Result<OpenedSession>>;
  ptyWrite(sessionId: string, data: string): void;
  ptyResize(input: { sessionId: string; cols: number; rows: number }): void;
  ptyClose(sessionId: string): void;
  onPtyData(cb: (e: { sessionId: string; data: string }) => void): () => void;
  onPtyExit(cb: (e: { sessionId: string; exitCode: number }) => void): () => void;
}

export const CHANNELS = {
  listAccounts: 'inova:listAccounts',
  addAccount: 'inova:addAccount',
  removeAccount: 'inova:removeAccount',
  listProjects: 'inova:listProjects',
  pickFolder: 'inova:pickFolder',
  bindProject: 'inova:bindProject',
  unbindProject: 'inova:unbindProject',
  listSessions: 'inova:listSessions',
  createSession: 'inova:createSession',
  renameSession: 'inova:renameSession',
  deleteSession: 'inova:deleteSession',
  loadTranscript: 'inova:loadTranscript',
  sendMessage: 'inova:sendMessage',
  cancelTurn: 'inova:cancelTurn',
  getUsage: 'inova:getUsage',
  chatEvent: 'inova:chat:event',
  openLogin: 'inova:openLogin',
  ptyWrite: 'inova:pty:write',
  ptyResize: 'inova:pty:resize',
  ptyClose: 'inova:pty:close',
  ptyData: 'inova:pty:data',
  ptyExit: 'inova:pty:exit',
} as const;

declare global {
  interface Window {
    inova: InovaApi;
  }
}
