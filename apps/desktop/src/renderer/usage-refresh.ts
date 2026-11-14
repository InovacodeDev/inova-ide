import type { AccountView } from '../shared/api';
import { SESSION_EXPIRED_USAGE_MESSAGE } from '../shared/api';
import type { UsageState } from './UsageBar';

export const USAGE_REFRESH_INTERVAL_MS = 60_000;

export function refreshableUsageLabels(
  accounts: readonly AccountView[],
  inflight: ReadonlySet<string>,
): string[] {
  return accounts
    .filter((account) => account.status === 'logged-in' && !inflight.has(account.label))
    .map((account) => account.label);
}

export function settleUsage(input: {
  current: UsageState | undefined;
  next: UsageState;
  background: boolean;
}): UsageState {
  const { current, next, background } = input;
  const transientFailure =
    next.status === 'error' && next.message !== SESSION_EXPIRED_USAGE_MESSAGE;
  if (background && transientFailure && current?.status === 'ready') return current;
  return next;
}
