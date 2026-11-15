import type { CommandRunner } from '../providers.js';
import type { Account } from '../types.js';

export type CapabilityKind = 'skill' | 'mcp' | 'connector' | 'plugin';

export type CapabilityApplyMode = 'launch' | 'account-file' | 'global-file' | 'unsupported';

export interface CapabilityRef {
  kind: CapabilityKind;
  id: string;
}

export interface CapabilityItem {
  kind: CapabilityKind;
  id: string;
  name: string;
  description: string | null;
  source: 'user' | 'plugin' | 'connector' | 'bundled';
  enabled: boolean;
  applyMode: CapabilityApplyMode;
  unsupportedReason: string | null;
  tokens: number | null;
  group: string | null;
}

export interface CapabilityCostSummary {
  loadedTokens: number | null;
  instructionTokens: number | null;
  deferredTokens: number | null;
}

export interface CapabilityCategoryResult {
  kind: CapabilityKind;
  items: CapabilityItem[];
  error: string | null;
}

export interface CapabilityListing {
  categories: CapabilityCategoryResult[];
  cost: CapabilityCostSummary | null;
}

export interface CapabilityContext {
  account: Account;
  runner: CommandRunner;
  env: NodeJS.ProcessEnv;
  projectPath: string | null;
  backupRoot: string;
}

export interface SetEnabledInput {
  ctx: CapabilityContext;
  ref: CapabilityRef;
  enabled: boolean;
}

export interface CapabilityAdapter {
  list(ctx: CapabilityContext): Promise<CapabilityListing>;
  launchArgs(disabled: readonly CapabilityRef[]): string[];
  setEnabled(input: SetEnabledInput): Promise<void>;
}

const CAPABILITY_KINDS: readonly string[] = ['skill', 'mcp', 'connector', 'plugin'];
const MAX_CAPABILITY_ID_LENGTH = 512;

export function isCapabilityRef(value: unknown): value is CapabilityRef {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, id } = value as Record<string, unknown>;
  return (
    typeof kind === 'string' &&
    CAPABILITY_KINDS.includes(kind) &&
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= MAX_CAPABILITY_ID_LENGTH
  );
}
