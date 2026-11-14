import type { CapabilityAdapter, CapabilityListing, CapabilityRef } from './types.js';

const ALL_CONNECTORS_ID = '*';

export function normalizeMcpName(name: string): string {
  return name.replaceAll(/[^A-Za-z0-9_-]/g, '_');
}

function isDisabled(disabled: readonly CapabilityRef[], ref: CapabilityRef): boolean {
  return disabled.some((entry) => entry.kind === ref.kind && entry.id === ref.id);
}

function list(): Promise<CapabilityListing> {
  return Promise.reject(new Error('Claude capability listing is not implemented.'));
}

function launchArgs(disabled: readonly CapabilityRef[]): string[] {
  if (disabled.length === 0) return [];
  const allConnectorsOff = isDisabled(disabled, { kind: 'connector', id: ALL_CONNECTORS_ID });
  const deny: string[] = [];
  const skillOverrides: Record<string, 'off'> = {};
  const enabledPlugins: Record<string, false> = {};
  for (const ref of disabled) {
    if (ref.kind === 'skill') skillOverrides[ref.id] = 'off';
    else if (ref.kind === 'plugin') enabledPlugins[ref.id] = false;
    else if (ref.kind === 'mcp' || !allConnectorsOff) deny.push(`mcp__${normalizeMcpName(ref.id)}`);
  }
  const settings: Record<string, unknown> = {
    ...(deny.length > 0 ? { permissions: { deny } } : {}),
    ...(Object.keys(skillOverrides).length > 0 ? { skillOverrides } : {}),
    ...(Object.keys(enabledPlugins).length > 0 ? { enabledPlugins } : {}),
    ...(allConnectorsOff ? { disableClaudeAiConnectors: true } : {}),
  };
  return Object.keys(settings).length === 0 ? [] : ['--settings', JSON.stringify(settings)];
}

export const claudeCapabilities: CapabilityAdapter = {
  list,
  launchArgs,
  setEnabled: () => Promise.reject(new Error('Claude usa só o modo launch.')),
};
