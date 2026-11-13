import type { AuthStatus } from '@inova/core/providers';
import type { ChatEvent, UsageSnapshot } from '@inova/core/chat-types';
import type { ProjectCommand } from '@inova/core/commands';
import type { ComparisonDiffView } from '@inova/core/git-compare';
import type { ProviderModels } from '@inova/core/models';
import type {
  ProfileSyncApplyResult,
  ProfileSyncPreview,
  RulesFile,
  RulesStrategy,
} from '@inova/core/profile-sync';

export type {
  ComparisonDiffView,
  ComparisonFileDiff,
  ComparisonSideSummary,
} from '@inova/core/git-compare';
export type {
  ProfileSyncApplyResult,
  ProfileSyncItem,
  ProfileSyncPreview,
  ProfileSyncStatus,
  RulesFile,
  RulesStrategy,
} from '@inova/core/profile-sync';
import type { ExternalSession, ImportProvider } from '@inova/core/session-import';
import type {
  EffortLevel,
  ExecutionMode,
  InboxItem,
  ProviderId,
  QueuedTurn,
  Session,
  Settings,
  SettingsPatch,
  VerificationCheck,
  VoiceModelId,
  Workspace,
} from '@inova/core/types';

export type ProjectCommandView = ProjectCommand;

export interface ProjectFileSearchResult {
  files: string[];
  truncated: boolean;
}

export interface WorktreeStatusView {
  branch: string;
  changedFiles: string[];
  diffStat: string;
  diff: string;
  dirty: boolean;
}

export type SessionView = Session;

export type { ImportProvider } from '@inova/core/session-import';

export interface ExternalSessionView extends ExternalSession {
  imported: boolean;
}

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
  autoWorktree?: boolean;
  autoVerify?: boolean;
  verificationChecks?: VerificationCheck[];
}

export interface VoiceModelInfo {
  id: VoiceModelId;
  label: string;
  bytes: number;
}

export interface VoiceStatus {
  binary: boolean;
  model: boolean;
  modelBytes: number;
  modelId: VoiceModelId;
  installed: VoiceModelId[];
  catalog: VoiceModelInfo[];
}

export interface VoiceModelProgress {
  modelId: VoiceModelId;
  receivedBytes: number;
  totalBytes: number;
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
    isolatedWorktree?: boolean;
  }): Promise<Result<SessionView>>;
  updateSession(input: {
    sessionId: string;
    title?: string;
    archived?: boolean;
    model?: string | null;
    effort?: EffortLevel | null;
    mode?: ExecutionMode | null;
  }): Promise<Result<SessionView>>;
  getDefaultModes(): Promise<Result<Partial<Record<ProviderId, ExecutionMode>>>>;
  setDefaultMode(input: {
    provider: ProviderId;
    mode: ExecutionMode;
  }): Promise<Result<Partial<Record<ProviderId, ExecutionMode>>>>;
  getSettings(): Promise<Result<Settings>>;
  updateSettings(input: SettingsPatch): Promise<Result<Settings>>;
  sendTestNotification(): Promise<Result<null>>;
  openNotificationSettings(): Promise<Result<null>>;
  openDataFolder(): Promise<Result<null>>;
  deleteSession(input: { sessionId: string; force?: boolean }): Promise<Result<null>>;
  getWorktreeStatus(input: { sessionId: string }): Promise<Result<WorktreeStatusView>>;
  applyWorktree(input: { sessionId: string }): Promise<Result<{ appliedFiles: string[] }>>;
  restoreCheckpoint(input: {
    sessionId: string;
    ref: string;
    preserveFiles?: string[];
  }): Promise<Result<null>>;
  detectProjectChecks(input: { projectId: string }): Promise<Result<VerificationCheck[]>>;
  updateProjectVerification(input: {
    projectId: string;
    autoWorktree?: boolean;
    autoVerify?: boolean;
    verificationChecks?: VerificationCheck[];
  }): Promise<Result<ProjectView>>;
  runVerification(input: { sessionId: string }): Promise<Result<null>>;
  getWorkspace(): Promise<Result<WorkspaceView>>;
  saveWorkspace(input: WorkspaceView): Promise<Result<null>>;
  loadTranscript(input: { sessionId: string }): Promise<Result<ChatEvent[]>>;
  sendMessage(input: {
    sessionId: string;
    prompt: string;
    extraDirs?: string[];
  }): Promise<Result<null>>;
  getPathForFile(file: File): string;
  getVoiceStatus(): Promise<Result<VoiceStatus>>;
  downloadVoiceModel(input?: { modelId: VoiceModelId }): Promise<Result<null>>;
  deleteVoiceModel(input: { modelId: VoiceModelId }): Promise<Result<VoiceStatus>>;
  transcribeAudio(input: {
    pcm: Uint8Array;
    final: boolean;
    language: string;
    hints: string[];
  }): Promise<Result<{ text: string }>>;
  onVoiceModelProgress(callback: (progress: VoiceModelProgress) => void): () => void;
  enqueueTurn(input: { sessionId: string; prompt: string }): Promise<Result<QueuedTurn>>;
  cancelQueuedTurn(input: { turnId: string }): Promise<Result<null>>;
  listTurnQueue(): Promise<Result<QueuedTurn[]>>;
  switchSessionAccount(input: {
    sessionId: string;
    accountId: string;
    generateHandoff?: boolean;
  }): Promise<Result<{ session: SessionView; hadHistory: boolean }>>;
  handoffSession(input: {
    sessionId: string;
    targetAccountId: string;
    createWorktree?: boolean;
  }): Promise<Result<{ session: SessionView; handoffContext: string }>>;
  forkSession(input: {
    sessionId: string;
    turnIndex: number;
    targetAccountId?: string;
    copyWorktreeFiles?: boolean;
  }): Promise<Result<{ session: SessionView; strategy: 'native-claude' | 'summary-handoff' }>>;
  listExternalSessions(input: { projectId: string }): Promise<Result<ExternalSessionView[]>>;
  importSessions(input: {
    projectId: string;
    provider: ImportProvider;
    accountId: string;
    sessionIds: string[];
  }): Promise<Result<SessionView[]>>;
  listInbox(): Promise<Result<InboxItem[]>>;
  markInboxRead(input: { sessionId: string }): Promise<Result<InboxItem[]>>;
  clearReadInbox(): Promise<Result<InboxItem[]>>;
  reportUiFocus(input: { activeSessionId: string | null; windowFocused: boolean }): void;
  cancelTurn(sessionId: string): void;
  getUsage(input: { accountLabel: string }): Promise<Result<UsageSnapshot>>;
  listModels(input: { accountLabel: string }): Promise<Result<ProviderModels>>;
  searchFiles(input: {
    projectId: string;
    query: string;
    limit?: number;
    sessionId?: string;
  }): Promise<Result<ProjectFileSearchResult>>;
  listCommands(input: { projectId: string }): Promise<Result<ProjectCommandView[]>>;
  startComparison(input: {
    projectId: string;
    prompt: string;
    leftAccountId: string;
    rightAccountId: string;
    leftModel?: string | null;
    leftEffort?: EffortLevel | null;
    leftMode?: ExecutionMode | null;
    rightModel?: string | null;
    rightEffort?: EffortLevel | null;
    rightMode?: ExecutionMode | null;
  }): Promise<Result<{ groupId: string; left: SessionView; right: SessionView }>>;
  getComparisonDiff(input: { groupId: string }): Promise<Result<ComparisonDiffView>>;
  resolveComparison(input: {
    groupId: string;
    winner: 'left' | 'right';
    cleanupWorktrees?: boolean;
  }): Promise<Result<{ appliedFiles: string[]; winnerSessionId: string }>>;
  previewProfileSync(input: {
    projectId: string;
    accountIds?: string[];
    rulesSource?: RulesFile | null;
    sourceAccountId?: string | null;
  }): Promise<Result<ProfileSyncPreview>>;
  applyProfileSync(input: {
    projectId: string;
    accountIds?: string[];
    rulesSource?: RulesFile | null;
    sourceAccountId?: string | null;
    approvedIds: string[];
    rulesStrategy?: RulesStrategy;
  }): Promise<Result<ProfileSyncApplyResult>>;
  onChatEvent(cb: (e: { sessionId: string; event: ChatEvent }) => void): () => void;
  onInboxEvent(cb: (items: InboxItem[]) => void): () => void;
  onQueueEvent(cb: (queue: QueuedTurn[]) => void): () => void;
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
  getDefaultModes: 'inova:getDefaultModes',
  setDefaultMode: 'inova:setDefaultMode',
  getSettings: 'inova:getSettings',
  updateSettings: 'inova:updateSettings',
  sendTestNotification: 'inova:sendTestNotification',
  openNotificationSettings: 'inova:openNotificationSettings',
  openDataFolder: 'inova:openDataFolder',
  deleteSession: 'inova:deleteSession',
  getWorktreeStatus: 'inova:getWorktreeStatus',
  applyWorktree: 'inova:applyWorktree',
  restoreCheckpoint: 'inova:restoreCheckpoint',
  detectProjectChecks: 'inova:detectProjectChecks',
  updateProjectVerification: 'inova:updateProjectVerification',
  runVerification: 'inova:runVerification',
  getWorkspace: 'inova:getWorkspace',
  saveWorkspace: 'inova:saveWorkspace',
  loadTranscript: 'inova:loadTranscript',
  sendMessage: 'inova:sendMessage',
  enqueueTurn: 'inova:enqueueTurn',
  cancelQueuedTurn: 'inova:cancelQueuedTurn',
  listTurnQueue: 'inova:listTurnQueue',
  switchSessionAccount: 'inova:switchSessionAccount',
  handoffSession: 'inova:handoffSession',
  forkSession: 'inova:forkSession',
  listExternalSessions: 'inova:listExternalSessions',
  importSessions: 'inova:importSessions',
  listInbox: 'inova:listInbox',
  markInboxRead: 'inova:markInboxRead',
  clearReadInbox: 'inova:clearReadInbox',
  reportUiFocus: 'inova:reportUiFocus',
  cancelTurn: 'inova:cancelTurn',
  getUsage: 'inova:getUsage',
  listModels: 'inova:listModels',
  searchFiles: 'inova:searchFiles',
  listCommands: 'inova:listCommands',
  startComparison: 'inova:startComparison',
  getComparisonDiff: 'inova:getComparisonDiff',
  resolveComparison: 'inova:resolveComparison',
  previewProfileSync: 'inova:previewProfileSync',
  applyProfileSync: 'inova:applyProfileSync',
  chatEvent: 'inova:chat:event',
  inboxEvent: 'inova:inbox:event',
  queueEvent: 'inova:queue:event',
  startLogin: 'inova:startLogin',
  submitLoginCode: 'inova:submitLoginCode',
  cancelLogin: 'inova:cancelLogin',
  loginEvent: 'inova:login:event',
  getVoiceStatus: 'inova:getVoiceStatus',
  downloadVoiceModel: 'inova:downloadVoiceModel',
  deleteVoiceModel: 'inova:deleteVoiceModel',
  transcribeAudio: 'inova:transcribeAudio',
  voiceModelProgress: 'inova:voice:model-progress',
} as const;

declare global {
  interface Window {
    inova: InovaApi;
  }
}
