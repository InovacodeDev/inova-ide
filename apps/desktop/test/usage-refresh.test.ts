import { describe, expect, test } from 'vitest';
import type { UsageSnapshot } from '@inova/core/chat-types';
import type { AccountView } from '../src/shared/api';
import { SESSION_EXPIRED_USAGE_MESSAGE } from '../src/shared/api';
import { refreshableUsageLabels, settleUsage } from '../src/renderer/usage-refresh';
import type { UsageState } from '../src/renderer/UsageBar';

const account = (label: string, status: AccountView['status'] = 'logged-in'): AccountView => ({
  id: label,
  label,
  email: null,
  provider: 'claude',
  status,
});

const snapshot: UsageSnapshot = {
  provider: 'claude',
  windows: [],
  source: 'api',
  fetchedAt: '2026-11-14T00:00:00.000Z',
};
const ready: UsageState = { status: 'ready', snapshot };
const failure: UsageState = { status: 'error', message: 'Não foi possível ler o consumo.' };

describe('refreshableUsageLabels', () => {
  test('returns only logged-in accounts without a request in flight', () => {
    const accounts = [account('a'), account('b', 'expired'), account('c'), account('d')];
    expect(refreshableUsageLabels(accounts, new Set(['c']))).toEqual(['a', 'd']);
  });
});

describe('settleUsage', () => {
  test('replaces the state on a manual load', () => {
    expect(settleUsage({ current: ready, next: failure, background: false })).toBe(failure);
  });

  test('keeps the last snapshot when a background refresh fails', () => {
    expect(settleUsage({ current: ready, next: failure, background: true })).toBe(ready);
  });

  test('shows an expired session even on a background refresh', () => {
    const expired: UsageState = { status: 'error', message: SESSION_EXPIRED_USAGE_MESSAGE };
    expect(settleUsage({ current: ready, next: expired, background: true })).toBe(expired);
  });

  test('shows the error when there is no snapshot to keep', () => {
    expect(settleUsage({ current: undefined, next: failure, background: true })).toBe(failure);
  });

  test('uses the fresh snapshot on success', () => {
    const fresh: UsageState = { status: 'ready', snapshot: { ...snapshot, fetchedAt: 'x' } };
    expect(settleUsage({ current: ready, next: fresh, background: true })).toBe(fresh);
  });
});
