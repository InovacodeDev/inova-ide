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
  model?: string | null;
  effort?: EffortLevel | null;
  mode?: ExecutionMode | null;
  worktree?: SessionWorktree | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface Workspace {
  openSessionIds: string[];
  activeSessionId: string | null;
}

export interface Store {
  version: 1;
  accounts: Account[];
  projects: Project[];
  sessions?: Session[];
  workspace?: Workspace;
  defaultModes?: Partial<Record<ProviderId, ExecutionMode>>;
}
