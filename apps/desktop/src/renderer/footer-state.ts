import type { ProviderId } from '@inova/core/types';
import type { AccountView } from '../shared/api';

export interface ProviderGroup {
  provider: ProviderId;
  accounts: AccountView[];
  connected: number;
}

export const PROVIDER_ORDER: readonly ProviderId[] = ['claude', 'codex', 'gemini'];

export function groupByProvider(accounts: readonly AccountView[]): ProviderGroup[] {
  return PROVIDER_ORDER.flatMap((provider) => {
    const own = accounts.filter((account) => account.provider === provider);
    if (own.length === 0) return [];
    return [
      {
        provider,
        accounts: own,
        connected: own.filter((account) => account.status === 'logged-in').length,
      },
    ];
  });
}

export function highlightedProvider(input: {
  groups: ProviderGroup[];
  focusedProvider: ProviderId | null;
}): ProviderId | null {
  const { groups, focusedProvider } = input;
  if (focusedProvider && groups.some((group) => group.provider === focusedProvider)) {
    return focusedProvider;
  }
  return groups[0]?.provider ?? null;
}

export function formatResetIn(input: { resetsAt: string | null; now: Date }): string | null {
  if (input.resetsAt === null) return null;
  const target = Date.parse(input.resetsAt);
  if (Number.isNaN(target)) return null;
  const totalMinutes = Math.floor((target - input.now.getTime()) / 60_000);
  if (totalMinutes <= 0) return 'agora';
  if (totalMinutes >= 24 * 60) return `em ${Math.floor(totalMinutes / (24 * 60))} d`;
  if (totalMinutes < 60) return `em ${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `em ${hours} h` : `em ${hours} h ${minutes} min`;
}

export function usageLevel(percent: number): 'ok' | 'warn' | 'critical' {
  if (percent > 90) return 'critical';
  if (percent >= 70) return 'warn';
  return 'ok';
}
