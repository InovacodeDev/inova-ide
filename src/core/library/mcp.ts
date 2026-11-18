import type { CapabilityRef } from '../capabilities/types.js';
import type { CanonicalMcpMap, McpServerConfig } from '../profile-sync.js';
import type { ProviderId } from '../types.js';
import { resolveEffectiveItems } from './effective.js';
import type { ConnectorLibraryItem, LibraryItem, McpLibraryItem } from './types.js';

type McpProjectableItem = McpLibraryItem | ConnectorLibraryItem;

export interface LibraryMcpProjection {
  servers: CanonicalMcpMap;
  libraryNames: string[];
  unverifiedNames: string[];
}

const VARIABLE_VERIFIED_PROVIDERS: readonly ProviderId[] = ['claude'];

function isMcpProjectable(item: LibraryItem): item is McpProjectableItem {
  return item.kind === 'mcp' || item.kind === 'connector';
}

function referencesVariable(server: McpServerConfig): boolean {
  return JSON.stringify(server).includes('${');
}

export function mergeLibraryMcp(input: {
  projectServers: CanonicalMcpMap;
  items: readonly LibraryItem[];
}): CanonicalMcpMap {
  const { projectServers, items } = input;
  const result: CanonicalMcpMap = { ...projectServers };
  for (const item of items) {
    if (!item.enabled || !isMcpProjectable(item)) continue;
    if (Object.hasOwn(projectServers, item.id)) continue;
    result[item.id] = structuredClone(item.definition);
  }
  return result;
}

export function projectLibraryMcp(input: {
  projectServers: CanonicalMcpMap;
  items: readonly LibraryItem[];
  projectDisabled: readonly string[];
  accountDisabled: readonly CapabilityRef[];
  provider: ProviderId;
}): LibraryMcpProjection {
  const { projectServers, provider } = input;
  const candidates = resolveEffectiveItems(input)
    .filter(isMcpProjectable)
    .filter((item) => !Object.hasOwn(projectServers, item.id));
  const variablesVerified = VARIABLE_VERIFIED_PROVIDERS.includes(provider);
  const allowed = variablesVerified
    ? candidates
    : candidates.filter((item) => !referencesVariable(item.definition));
  const servers = mergeLibraryMcp({ projectServers, items: allowed });
  return {
    servers,
    libraryNames: allowed.map((item) => item.id),
    unverifiedNames: candidates.filter((item) => !allowed.includes(item)).map((item) => item.id),
  };
}
