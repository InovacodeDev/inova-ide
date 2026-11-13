import { PROVIDER_MODES, resolveExecutionMode, type ProviderModeOption } from '@inova/core/modes';
import type { ExecutionMode, ProviderId } from '@inova/core/types';

export function effectiveModeForSession(input: {
  provider: ProviderId;
  sessionMode?: ExecutionMode | null;
  defaultModes?: Partial<Record<ProviderId, ExecutionMode>>;
}): ExecutionMode {
  return resolveExecutionMode(input);
}

export function findModeOption(provider: ProviderId, mode: ExecutionMode): ProviderModeOption {
  const catalog = PROVIDER_MODES[provider];
  return catalog.options.find((opt) => opt.id === mode) ?? catalog.options[0]!;
}

export function optionByShortcutKey(provider: ProviderId, key: string): ProviderModeOption | null {
  if (!/^[1-9]$/.test(key)) return null;
  const index = Number(key) - 1;
  return PROVIDER_MODES[provider].options[index] ?? null;
}

export function isRiskyBypassMode(mode: ExecutionMode, inWorktree: boolean): boolean {
  return mode === 'bypass' && !inWorktree;
}
