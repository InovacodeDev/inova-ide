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

export interface PluginRecipeDefinition {
  format?: 'recipe';
  provider: ProviderId;
  marketplace?: string;
  name: string;
}

export type PluginManifestFormat = 'claude' | 'codex' | 'cursor' | 'antigravity' | 'generic';

export interface PluginPackageSkillMeta {
  id: string;
  name: string;
  description: string | null;
  path: string;
}

export interface PluginPackageCommandMeta {
  name: string;
  description: string | null;
  path: string;
}

export interface PluginPackageDefinition {
  format: 'package';
  manifestFormat: PluginManifestFormat;
  version?: string;
  hash: string;
  skills: PluginPackageSkillMeta[];
  commands: PluginPackageCommandMeta[];
  mcpServers?: string[];
}

export type PluginDefinition = PluginRecipeDefinition | PluginPackageDefinition;

export function isPluginPackage(def: PluginDefinition): def is PluginPackageDefinition {
  return def.format === 'package';
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
