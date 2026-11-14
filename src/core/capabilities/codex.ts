import { tomlTableHeader } from './file-edit.js';
import type { CapabilityAdapter, CapabilityRef } from './types.js';

function launchArgs(disabled: readonly CapabilityRef[]): string[] {
  return disabled
    .filter((ref) => ref.kind === 'mcp')
    .flatMap((ref) => ['-c', `${tomlTableHeader(['mcp_servers', ref.id])}.enabled=false`]);
}

export const codexCapabilities: CapabilityAdapter = {
  list: () => Promise.resolve({ categories: [], cost: null }),
  launchArgs,
  setEnabled: () => Promise.reject(new Error('MCP do Codex usa só o modo launch.')),
};
