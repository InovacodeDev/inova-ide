import type { AuthStatus } from '@inova/core/providers';
import type { ChatEvent, UsageSnapshot } from '@inova/core/chat-types';
import type { ProjectCommand } from '@inova/core/commands';
import type { ProviderModels } from '@inova/core/models';
import type { EffortLevel, ProviderId, Session, Workspace } from '@inova/core/types';

export type ProjectCommandView = ProjectCommand;

export interface ProjectFileSearchResult {
  files: string[];
  truncated: boolean;
}

export type SessionView = Session;

export type WorkspaceView = Workspace;

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export interface AccountView {
  id: string;
  label: string;
  email: string | null;
  provider: ProviderId;
  status: AuthStatus;
}

export interface ProjectView {
  id: string;
  path: string;
  accountLabel: string;
  accountEmail: string | null;
  provider: ProviderId;
}

export type LoginStage =
  'starting' | 'waiting-auth' | 'verifying' | 'succeeded' | 'failed' | 'canceled';

export interface LoginEvent {
  sessionId: string;
  stage: LoginStage;
  authUrl: string | null;
  codePrompt: boolean;
  message: string | null;
}

export interface StartedLogin {
  sessionId: string;
  accountLabel: string;
  provider: ProviderId;
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
  updateSession(input: {
    sessionId: string;
    title?: string;
    archived?: boolean;
    model?: string | null;
    effort?: EffortLevel | null;
  }): Promise<Result<SessionView>>;
  deleteSession(input: { sessionId: string }): Promise<Result<null>>;
  getWorkspace(): Promise<Result<WorkspaceView>>;
  saveWorkspace(input: WorkspaceView): Promise<Result<null>>;
  loadTranscript(input: { sessionId: string }): Promise<Result<ChatEvent[]>>;
  sendMessage(input: { sessionId: string; prompt: string }): Promise<Result<null>>;
  cancelTurn(sessionId: string): void;
  getUsage(input: { accountLabel: string }): Promise<Result<UsageSnapshot>>;
  listModels(input: { accountLabel: string }): Promise<Result<ProviderModels>>;
  searchFiles(input: {
    projectId: string;
    query: string;
    limit?: number;
  }): Promise<Result<ProjectFileSearchResult>>;
  listCommands(input: { projectId: string }): Promise<Result<ProjectCommandView[]>>;
  onChatEvent(cb: (e: { sessionId: string; event: ChatEvent }) => void): () => void;
  startLogin(input: { accountLabel: string }): Promise<Result<StartedLogin>>;
  submitLoginCode(input: { sessionId: string; code: string }): Promise<Result<null>>;
  cancelLogin(sessionId: string): void;
  onLoginEvent(cb: (e: LoginEvent) => void): () => void;
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
  updateSession: 'inova:updateSession',
  deleteSession: 'inova:deleteSession',
  getWorkspace: 'inova:getWorkspace',
  saveWorkspace: 'inova:saveWorkspace',
  loadTranscript: 'inova:loadTranscript',
  sendMessage: 'inova:sendMessage',
  cancelTurn: 'inova:cancelTurn',
  getUsage: 'inova:getUsage',
  listModels: 'inova:listModels',
  searchFiles: 'inova:searchFiles',
  listCommands: 'inova:listCommands',
  chatEvent: 'inova:chat:event',
  startLogin: 'inova:startLogin',
  submitLoginCode: 'inova:submitLoginCode',
  cancelLogin: 'inova:cancelLogin',
  loginEvent: 'inova:login:event',
} as const;

declare global {
  interface Window {
    inova: InovaApi;
  }
}
