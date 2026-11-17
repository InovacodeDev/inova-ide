import type { McpHttpServer, McpServerConfig } from '../profile-sync.js';
import type { ProviderId } from '../types.js';

export type LibraryItemKind = 'skill' | 'mcp' | 'connector' | 'plugin';

export type LibraryItemSource = 'created' | 'imported';

interface LibraryItemBase {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  source: LibraryItemSource;
  updatedAt: string;
}

export interface SkillDefinition {
  hash: string;
}

export interface PluginDefinition {
  provider: ProviderId;
  marketplace?: string;
  name: string;
}

export interface SkillLibraryItem extends LibraryItemBase {
  kind: 'skill';
  definition: SkillDefinition;
}

export interface McpLibraryItem extends LibraryItemBase {
  kind: 'mcp';
  definition: McpServerConfig;
}

export interface ConnectorLibraryItem extends LibraryItemBase {
  kind: 'connector';
  definition: McpHttpServer;
  label: string;
}

export interface PluginLibraryItem extends LibraryItemBase {
  kind: 'plugin';
  definition: PluginDefinition;
}

export type LibraryItem =
  SkillLibraryItem | McpLibraryItem | ConnectorLibraryItem | PluginLibraryItem;

export interface Library {
  version: 1;
  items: LibraryItem[];
}

export interface InvalidLibraryEntry {
  id: string;
  error: string;
}

export interface LoadedLibrary {
  library: Library;
  invalid: InvalidLibraryEntry[];
}
