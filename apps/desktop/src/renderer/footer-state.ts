import type { UsageWindow } from '@inova/core/chat-types';
import type { ProviderId } from '@inova/core/types';
import type { AccountView } from '../shared/api';

export interface ProviderGroup {
  provider: ProviderId;
  accounts: AccountView[];
  connected: number;
}

export const PROVIDER_ORDER: readonly ProviderId[] = [
  'claude',
  'codex',
  'gemini',
  'deepseek',
  'kimi',
  'grok',
  'qwen',
  'opencode',
];

export const USAGE_WINDOW_ORDER: readonly UsageWindow['kind'][] = ['session', 'weekly', 'monthly'];

export function orderedUsageWindows(windows: readonly UsageWindow[]): UsageWindow[] {
  const scopes = [...new Set([undefined, ...windows.map((w) => w.scope)])];
  return scopes.flatMap((scope) =>
    USAGE_WINDOW_ORDER.flatMap((kind) =>
      windows.filter((w) => w.kind === kind && w.scope === scope),
    ),
  );
}

export function primaryUsageWindows(windows: readonly UsageWindow[]): UsageWindow[] {
  return orderedUsageWindows(windows).filter((w) => w.scope === undefined);
}

export function usageWindowKey(usageWindow: UsageWindow): string {
  return `${usageWindow.scope ?? ''}:${usageWindow.kind}`;
}

export function usageWindowLabel(input: {
  window: UsageWindow;
  labels: Record<UsageWindow['kind'], string>;
}): string {
  const base = input.labels[input.window.kind];
  return input.window.scope === undefined ? base : `${input.window.scope} · ${base}`;
}

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

export type ProviderHealth =
  { kind: 'ok' } | { kind: 'missing-cli' } | { kind: 'pending'; count: number };

export function providerHealth(accounts: readonly AccountView[]): ProviderHealth {
  if (accounts.some((account) => account.status === 'binary-missing')) {
    return { kind: 'missing-cli' };
  }
  const count = accounts.filter((account) => account.status !== 'logged-in').length;
  return count === 0 ? { kind: 'ok' } : { kind: 'pending', count };
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

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatResetIn(input: { resetsAt: string | null; now: Date }): string | null {
  if (input.resetsAt === null) return null;
  const target = Date.parse(input.resetsAt);
  if (Number.isNaN(target)) return null;
  const totalMinutes = Math.floor((target - input.now.getTime()) / 60_000);
  if (totalMinutes <= 0) return 'agora';
  const days = Math.floor(totalMinutes / (24 * 60));
  const restMinutes = totalMinutes % (24 * 60);
  const hours = Math.floor(restMinutes / 60);
  const minutes = restMinutes % 60;
  if (days > 0) return `${pad2(days)}d ${pad2(hours)}h ${pad2(minutes)}min`;
  return `${pad2(hours)}h ${pad2(minutes)}min`;
}

export function formatResetDateTime(resetsAt: string | null): string | null {
  if (resetsAt === null) return null;
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return null;
  const date = new Date(target);
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function usageLevel(percent: number): 'ok' | 'warn' | 'critical' {
  if (percent > 90) return 'critical';
  if (percent >= 70) return 'warn';
  return 'ok';
}
