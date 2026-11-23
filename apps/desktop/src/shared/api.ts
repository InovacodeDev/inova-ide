import type { AuthStatus } from '@inova/core/providers';
import type { CapabilityKind, CapabilityListing } from '@inova/core/capabilities/types';
import type { ChatEvent, ContextBreakdown, UsageSnapshot } from '@inova/core/chat-types';
import type { ProjectCommand } from '@inova/core/commands';
import type { ComparisonDiffView } from '@inova/core/git-compare';
import type { CommandEvent } from './command-types.js';
import type {
  InvalidLibraryEntry,
  LibraryItem,
  PluginDefinition,
  PluginInstallRecipe,
} from '@inova/core/library/index';
import type { ProviderModels } from '@inova/core/models';
import type {
  McpHttpServer,
  McpServerConfig,
  ProfileSyncApplyResult,
  ProfileSyncPreview,
  RulesFile,
  RulesStrategy,
} from '@inova/core/profile-sync';

export type {
  ConnectorLibraryItem,
  InvalidLibraryEntry,
  LibraryItem,
  LibraryItemKind,
  McpLibraryItem,
  PluginDefinition,
  PluginInstallRecipe,
  PluginLibraryItem,
  SkillLibraryItem,
} from '@inova/core/library/index';

export type {
  CapabilityApplyMode,
  CapabilityCategoryResult,
  CapabilityCostSummary,
  CapabilityItem,
  CapabilityKind,
  CapabilityListing,
} from '@inova/core/capabilities/types';
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
  SessionOrchestratorConfig,
  Settings,
  SettingsPatch,
  VerificationCheck,
  VoiceModelId,
  VoicePolishMode,
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
  scope?: 'session';
}

export type { SessionOrchestratorConfig } from '@inova/core/types';

export type SessionView = Session;

export type { ImportProvider } from '@inova/core/session-import';

export interface ExternalSessionView extends ExternalSession {
  imported: boolean;
}

export type WorkspaceView = Workspace;

export const ATTACHMENT_KINDS = ['images', 'documents', 'any'] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface PickedAttachment {
  path: string;
  isDirectory: boolean;
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  releaseUrl: string | null;
}

export type UpdateInstallStage =
  'preparing' | 'fetching' | 'downloading' | 'finalizing' | 'restarting';

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export interface RunCommandInput {
  commandId: string;
  params?: unknown;
  projectId?: string;
  accountId?: string;
}

export type RunCommandOutcome =
  | { status: 'started'; runId: string }
  | { status: 'needs-confirmation'; confirmationId: string; argv: string[]; cwd: string };

export interface LibraryListing {
  items: LibraryItem[];
  pluginRecipes: Record<string, PluginInstallRecipe>;
  invalidItems: InvalidLibraryEntry[];
}

interface SaveLibraryItemBase {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
}

export type SaveLibraryItemInput = SaveLibraryItemBase &
  (
    | { kind: 'skill'; content?: string }
    | { kind: 'mcp'; definition: McpServerConfig }
    | { kind: 'connector'; definition: McpHttpServer; label: string }
    | { kind: 'plugin'; definition: PluginDefinition }
  );

export interface RemoveLibraryItemInput {
  id: string;
}

export interface SetProjectOverrideInput {
  projectId: string;
  itemId: string;
  disabled: boolean;
}

export interface PreviewLibrarySyncInput {
  projectId: string;
  accountIds?: string[];
}

export interface ApplyLibrarySyncInput extends PreviewLibrarySyncInput {
  approvedIds: string[];
}

export type AccountStatus = AuthStatus | 'expired';

export const SESSION_EXPIRED_USAGE_MESSAGE = 'Sessão da conta expirou. Renove o login em Contas.';

export interface AccountView {
  id: string;
  label: string;
  email: string | null;
  provider: ProviderId;
  status: AccountStatus;
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
  pinnedMemory?: string | null;
  libraryDisabled?: string[];
}

export interface VoiceModelInfo {
  id: VoiceModelId;
  label: string;
  bytes: number;
}

export interface VoiceStatus {
  binary: boolean;
  server?: boolean;
  model: boolean;
  modelBytes: number;
  modelId: VoiceModelId;
  installed: VoiceModelId[];
  catalog: VoiceModelInfo[];
  polishModels?: string[];
}

export interface VoicePolishCheckResult {
  endpoint: string;
  reachable: boolean;
  models: string[];
  checkedAt: string;
  error?: string;
}

export type VoiceDockerStage = 'checking' | 'starting' | 'waiting' | 'pulling' | 'ready';

export interface VoiceDockerProgress {
  stage: VoiceDockerStage;
  model: string;
  percent: number | null;
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

export interface FailoverEvent {
  session: Session;
  rollbackLastTurn: boolean;
  fromAccountId?: string;
  toAccountId?: string;
}

export type FilePreviewSource = 'project' | 'user-drop' | 'picker';

export type FilePreviewKind =
  'text' | 'markdown' | 'html' | 'spreadsheet' | 'image' | 'pdf' | 'binary' | 'too-large';

export interface SpreadsheetSheet {
  name: string;
  columns: string[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

export interface FilePreviewBase {
  resolvedPath: string;
  name: string;
  extension: string;
  sizeBytes: number;
  mtimeMs: number;
}

export type FilePreview =
  | (FilePreviewBase & { kind: 'text'; content: string })
  | (FilePreviewBase & { kind: 'markdown'; content: string })
  | (FilePreviewBase & { kind: 'html'; content: string; previewUrl?: string })
  | (FilePreviewBase & { kind: 'image'; previewUrl?: string; content?: string })
  | (FilePreviewBase & { kind: 'pdf'; previewUrl?: string })
  | (FilePreviewBase & { kind: 'spreadsheet'; sheets: SpreadsheetSheet[] })
  | (FilePreviewBase & { kind: 'binary'; reason: string })
  | (FilePreviewBase & { kind: 'too-large'; reason: string });

export interface ReadFilePreviewInput {
  path: string;
  projectId?: string;
  sessionId?: string;
  source: FilePreviewSource;
}

export interface OpenFilePathInput {
  path: string;
  projectId?: string;
  sessionId?: string;
  source: FilePreviewSource;
}

export interface InovaApi {
  readFilePreview(input: ReadFilePreviewInput): Promise<Result<FilePreview>>;
  pickViewerFiles(): Promise<Result<string[]>>;
  openFilePath(input: OpenFilePathInput): Promise<Result<null>>;
  listAccounts(): Promise<Result<AccountView[]>>;
  addAccount(input: { provider: string; label: string }): Promise<Result<AccountView>>;
  removeAccount(input: { label: string; force: boolean }): Promise<Result<null>>;
  listProjects(): Promise<Result<ProjectView[]>>;
  pickFolder(): Promise<string | null>;
  pickAttachments(input: { kind: AttachmentKind }): Promise<Result<PickedAttachment[]>>;
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
    pinnedMemory?: string | null;
    orchestrator?: SessionOrchestratorConfig | null;
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
  getAppInfo(): Promise<Result<{ version: string }>>;
  checkForUpdate(): Promise<Result<UpdateInfo>>;
  installUpdate(): Promise<Result<null>>;
  openExternalUrl(input: { url: string }): Promise<Result<null>>;
  onUpdateAvailable(cb: (info: UpdateInfo) => void): () => void;
  onUpdateProgress(cb: (stage: UpdateInstallStage) => void): () => void;
  deleteSession(input: { sessionId: string; force?: boolean }): Promise<Result<null>>;
  getWorktreeStatus(input: { sessionId: string }): Promise<Result<WorktreeStatusView>>;
  applyWorktree(input: { sessionId: string }): Promise<Result<{ appliedFiles: string[] }>>;
  restoreCheckpoint(input: {
    sessionId: string;
    ref?: string;
    preserveFiles?: string[];
    files?: string[];
  }): Promise<Result<null>>;
  detectProjectChecks(input: { projectId: string }): Promise<Result<VerificationCheck[]>>;
  updateProjectVerification(input: {
    projectId: string;
    autoWorktree?: boolean;
    autoVerify?: boolean;
    verificationChecks?: VerificationCheck[];
    pinnedMemory?: string | null;
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
  checkVoicePolish(input?: { endpoint?: string }): Promise<Result<VoicePolishCheckResult>>;
  setupVoiceDocker(input?: { model?: string }): Promise<Result<VoicePolishCheckResult>>;
  downloadVoiceModel(input?: { modelId: VoiceModelId }): Promise<Result<null>>;
  deleteVoiceModel(input: { modelId: VoiceModelId }): Promise<Result<VoiceStatus>>;
  transcribeAudio(input: {
    pcm: Uint8Array;
    final: boolean;
    language: string;
    hints: string[];
    polishMode?: VoicePolishMode;
  }): Promise<Result<{ text: string; rawText?: string; polished?: boolean }>>;
  onVoiceModelProgress(callback: (progress: VoiceModelProgress) => void): () => void;
  onVoiceDockerProgress(callback: (progress: VoiceDockerProgress) => void): () => void;
  enqueueTurn(input: {
    sessionId: string;
    prompt: string;
    extraDirs?: string[];
  }): Promise<Result<QueuedTurn>>;
  cancelQueuedTurn(input: { turnId: string }): Promise<Result<null>>;
  listTurnQueue(): Promise<Result<QueuedTurn[]>>;
  listPausedQueues(): Promise<Result<string[]>>;
  resumeSessionQueue(input: { sessionId: string }): Promise<Result<null>>;
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
  reviewSessionDiff(input: {
    sessionId: string;
  }): Promise<Result<{ session: SessionView; prompt: string }>>;
  rewindSession(input: { sessionId: string; turnIndex: number }): Promise<Result<{ text: string }>>;
  clearSession(input: { sessionId: string; keepContext?: boolean }): Promise<Result<null>>;
  recordFeedback(input: {
    sessionId: string;
    turnIndex: number;
    value: 'up' | 'down' | null;
  }): Promise<Result<null>>;
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
  getContextBreakdown(input: { sessionId: string }): Promise<Result<ContextBreakdown>>;
  listModels(input: { accountLabel: string }): Promise<Result<ProviderModels>>;
  listCapabilities(input: { accountLabel: string }): Promise<Result<CapabilityListing>>;
  setCapabilityEnabled(input: {
    accountLabel: string;
    kind: CapabilityKind;
    id: string;
    enabled: boolean;
  }): Promise<Result<CapabilityListing>>;
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
  listLibrary(): Promise<Result<LibraryListing>>;
  saveLibraryItem(input: SaveLibraryItemInput): Promise<Result<LibraryItem>>;
  removeLibraryItem(input: RemoveLibraryItemInput): Promise<Result<{ removed: boolean }>>;
  setProjectOverride(input: SetProjectOverrideInput): Promise<Result<{ disabled: string[] }>>;
  previewLibrarySync(input: PreviewLibrarySyncInput): Promise<Result<ProfileSyncPreview>>;
  applyLibrarySync(input: ApplyLibrarySyncInput): Promise<Result<ProfileSyncApplyResult>>;
  onChatEvent(cb: (e: { sessionId: string; event: ChatEvent }) => void): () => void;
  onInboxEvent(cb: (items: InboxItem[]) => void): () => void;
  onQueueEvent(cb: (queue: QueuedTurn[]) => void): () => void;
  onQueuePausedEvent(cb: (sessionIds: string[]) => void): () => void;
  onFailoverEvent(cb: (e: FailoverEvent) => void): () => void;
  startLogin(input: { accountLabel: string }): Promise<Result<StartedLogin>>;
  submitLoginCode(input: { sessionId: string; code: string }): Promise<Result<null>>;
  cancelLogin(sessionId: string): void;
  onLoginEvent(cb: (e: LoginEvent) => void): () => void;
  runCommand(input: RunCommandInput): Promise<Result<RunCommandOutcome>>;
  confirmCommand(input: { confirmationId: string }): Promise<Result<{ runId: string }>>;
  cancelCommand(runId: string): void;
  onCommandEvent(cb: (e: CommandEvent) => void): () => void;
}

export const CHANNELS = {
  listAccounts: 'inova:listAccounts',
  addAccount: 'inova:addAccount',
  removeAccount: 'inova:removeAccount',
  listProjects: 'inova:listProjects',
  pickFolder: 'inova:pickFolder',
  pickAttachments: 'inova:pickAttachments',
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
  getAppInfo: 'inova:getAppInfo',
  checkForUpdate: 'inova:checkForUpdate',
  installUpdate: 'inova:installUpdate',
  openExternalUrl: 'inova:openExternalUrl',
  updateAvailable: 'inova:update:available',
  updateProgress: 'inova:update:progress',
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
  listPausedQueues: 'inova:listPausedQueues',
  resumeSessionQueue: 'inova:resumeSessionQueue',
  switchSessionAccount: 'inova:switchSessionAccount',
  handoffSession: 'inova:handoffSession',
  forkSession: 'inova:forkSession',
  reviewSessionDiff: 'inova:reviewSessionDiff',
  rewindSession: 'inova:rewindSession',
  clearSession: 'inova:clearSession',
  recordFeedback: 'inova:recordFeedback',
  listExternalSessions: 'inova:listExternalSessions',
  importSessions: 'inova:importSessions',
  listInbox: 'inova:listInbox',
  markInboxRead: 'inova:markInboxRead',
  clearReadInbox: 'inova:clearReadInbox',
  reportUiFocus: 'inova:reportUiFocus',
  cancelTurn: 'inova:cancelTurn',
  getUsage: 'inova:getUsage',
  getContextBreakdown: 'inova:getContextBreakdown',
  listModels: 'inova:listModels',
  listCapabilities: 'inova:listCapabilities',
  setCapabilityEnabled: 'inova:setCapabilityEnabled',
  searchFiles: 'inova:searchFiles',
  listCommands: 'inova:listCommands',
  startComparison: 'inova:startComparison',
  getComparisonDiff: 'inova:getComparisonDiff',
  resolveComparison: 'inova:resolveComparison',
  previewProfileSync: 'inova:previewProfileSync',
  applyProfileSync: 'inova:applyProfileSync',
  listLibrary: 'inova:listLibrary',
  saveLibraryItem: 'inova:saveLibraryItem',
  removeLibraryItem: 'inova:removeLibraryItem',
  setProjectOverride: 'inova:setProjectOverride',
  previewLibrarySync: 'inova:previewLibrarySync',
  applyLibrarySync: 'inova:applyLibrarySync',
  chatEvent: 'inova:chat:event',
  inboxEvent: 'inova:inbox:event',
  queueEvent: 'inova:queue:event',
  queuePausedEvent: 'inova:queue:paused-event',
  failoverEvent: 'inova:session:failover',
  startLogin: 'inova:startLogin',
  submitLoginCode: 'inova:submitLoginCode',
  cancelLogin: 'inova:cancelLogin',
  loginEvent: 'inova:login:event',
  getVoiceStatus: 'inova:getVoiceStatus',
  checkVoicePolish: 'inova:checkVoicePolish',
  setupVoiceDocker: 'inova:setupVoiceDocker',
  downloadVoiceModel: 'inova:downloadVoiceModel',
  deleteVoiceModel: 'inova:deleteVoiceModel',
  transcribeAudio: 'inova:transcribeAudio',
  voiceModelProgress: 'inova:voice:model-progress',
  voiceDockerProgress: 'inova:voice:docker-progress',
  readFilePreview: 'inova:readFilePreview',
  pickViewerFiles: 'inova:pickViewerFiles',
  openFilePath: 'inova:openFilePath',
  runCommand: 'inova:runCommand',
  confirmCommand: 'inova:confirmCommand',
  cancelCommand: 'inova:cancelCommand',
  commandEvent: 'inova:command:event',
} as const;

declare global {
  interface Window {
    inova: InovaApi;
  }
}
