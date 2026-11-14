export type ProviderId =
  'claude' | 'codex' | 'gemini' | 'deepseek' | 'kimi' | 'grok' | 'qwen' | 'opencode';

export type EffortLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ExecutionMode = 'auto' | 'manual' | 'accept-edits' | 'plan' | 'bypass' | 'read-only';

export interface Account {
  id: string;
  provider: ProviderId;
  label: string;
  homeDir: string;
  createdAt: string;
}

export interface VerificationCheck {
  id: string;
  label: string;
  command: string;
  enabled: boolean;
}

export interface Project {
  id: string;
  path: string;
  accountId: string;
  autoWorktree?: boolean;
  autoVerify?: boolean;
  verificationChecks?: VerificationCheck[];
}

export interface SessionWorktree {
  path: string;
  branch: string;
  baseCommit: string;
  createdAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  providerSessionId: string | null;
  accountIdOverride?: string | null;
  handoffContext?: string | null;
  detachedFromParent?: boolean;
  comparisonGroupId?: string | null;
  comparisonRole?: 'left' | 'right' | null;
  model?: string | null;
  effort?: EffortLevel | null;
  mode?: ExecutionMode | null;
  worktree?: SessionWorktree | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type InboxAttentionKind = 'completed' | 'failed' | 'waiting-input';

export interface InboxItem {
  sessionId: string;
  projectId: string;
  sessionTitle: string;
  projectName: string;
  provider: ProviderId;
  kind: InboxAttentionKind;
  summary: string;
  at: string;
  unread: boolean;
}

export interface QueuedTurn {
  turnId: string;
  sessionId: string;
  accountId: string;
  prompt: string;
  enqueuedAt: string;
  extraDirs?: string[];
}

export interface Workspace {
  openSessionIds: string[];
  activeSessionId: string | null;
}

export type VoiceModelId = 'base' | 'small-q5_1' | 'medium-q5_0' | 'large-v3-turbo-q5_0';

export type ThemePreference = 'system' | 'dark' | 'light';

export interface Settings {
  appearance: {
    theme: ThemePreference;
    sidebarCollapsed: boolean;
  };
  voice: {
    language: 'auto' | 'pt' | 'en' | 'es';
    modelId: VoiceModelId;
  };
  sessions: {
    autoArchiveDays: 0 | 1 | 3 | 7 | 30;
    collapseFinishedTurns: boolean;
  };
  notifications: {
    waitingInput: boolean;
    failed: boolean;
    completed: boolean;
    onlyWhenUnfocused: boolean;
  };
  models: Record<ProviderId, ProviderModelDefaults>;
}

export interface ProviderModelDefaults {
  model: string | null;
  effort: EffortLevel;
}

export type SettingsPatch = { [Section in keyof Settings]?: Partial<Settings[Section]> };

export interface Store {
  version: 1;
  accounts: Account[];
  projects: Project[];
  sessions?: Session[];
  workspace?: Workspace;
  defaultModes?: Partial<Record<ProviderId, ExecutionMode>>;
  settings?: Settings;
}
