import type { CapabilityRef } from '../capabilities/types.js';
import type {
  CanonicalMcpMap,
  ProfileSyncLibraryInput,
  ProfileSyncStatus,
} from '../profile-sync.js';
import type { ProviderId } from '../types.js';
import { projectLibraryMcp } from './mcp.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function retainedMcpNames(input: {
  library: ProfileSyncLibraryInput;
  projectServers: CanonicalMcpMap;
  accountDisabled: readonly CapabilityRef[];
  provider: ProviderId;
}): Set<string> {
  const { library, projectServers, accountDisabled, provider } = input;
  const projectScoped = provider === 'opencode';
  const projected = projectLibraryMcp({
    projectServers,
    items: library.items,
    projectDisabled: projectScoped ? library.projectDisabled : [],
    accountDisabled,
    provider,
  });
  return new Set([...Object.keys(projected.servers), ...projected.unverifiedNames]);
}

export function removalCandidates(input: {
  managedNames: readonly string[];
  retained: ReadonlySet<string>;
}): string[] {
  return input.managedNames.filter((name) => !input.retained.has(name));
}

export function removalReason(names: readonly string[]): string {
  return `Remove MCP gerenciado: ${names.join(', ')}.`;
}

export function statusWithRemoval(status: ProfileSyncStatus): ProfileSyncStatus {
  return status === 'unchanged' || status === 'incompatible' ? 'update' : status;
}

export function withoutJsonServers(input: {
  raw: string;
  key: 'mcp' | 'mcpServers';
  names: readonly string[];
}): string {
  const { raw, key, names } = input;
  const root: unknown = JSON.parse(raw);
  if (!isRecord(root)) return raw;
  const servers = root[key];
  if (!isRecord(servers)) return raw;
  const kept = Object.entries(servers).filter(([name]) => !names.includes(name));
  return `${JSON.stringify({ ...root, [key]: Object.fromEntries(kept) }, null, 2)}\n`;
}

export async function removeAgyServers(input: {
  names: readonly string[];
  listed: ReadonlySet<string>;
  remove: (name: string) => Promise<boolean>;
}): Promise<{ dropped: string[]; failed: boolean }> {
  const { names, listed, remove } = input;
  const dropped: string[] = [];
  let failed = false;
  for (const name of names) {
    if (listed.has(name) && !(await remove(name))) {
      failed = true;
      continue;
    }
    dropped.push(name);
  }
  return { dropped, failed };
}
