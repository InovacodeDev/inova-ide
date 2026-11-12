export type ProviderId = 'claude' | 'codex' | 'gemini';

export interface Account {
  id: string;
  provider: ProviderId;
  label: string;
  homeDir: string;
  createdAt: string;
}

export interface Project {
  id: string;
  path: string;
  accountId: string;
}

export interface Session {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  providerSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  version: 1;
  accounts: Account[];
  projects: Project[];
  sessions?: Session[];
}
