import { describe, expect, test } from 'vitest';
import type { AccountView } from '../src/shared/api';
import {
  formatResetIn,
  groupByProvider,
  highlightedProvider,
  usageLevel,
} from '../src/renderer/footer-state';

const account = (
  label: string,
  provider: AccountView['provider'],
  status: AccountView['status'] = 'logged-in',
): AccountView => ({ id: label, label, provider, status });

describe('groupByProvider', () => {
  test('orders groups claude, codex, gemini and omits empty providers', () => {
    const groups = groupByProvider([
      account('g1', 'gemini'),
      account('c1', 'claude'),
      account('c2', 'claude'),
    ]);
    expect(groups.map((g) => g.provider)).toEqual(['claude', 'gemini']);
    expect(groups[0]?.accounts.map((a) => a.label)).toEqual(['c1', 'c2']);
  });

  test('counts only logged-in accounts as connected', () => {
    const [group] = groupByProvider([
      account('a', 'codex'),
      account('b', 'codex', 'logged-out'),
      account('c', 'codex', 'unknown'),
    ]);
    expect(group?.connected).toBe(1);
  });

  test('returns an empty list without accounts', () => {
    expect(groupByProvider([])).toEqual([]);
  });
});

describe('highlightedProvider', () => {
  const groups = groupByProvider([account('x', 'codex'), account('y', 'gemini')]);

  test('picks the focused provider when it has a group', () => {
    expect(highlightedProvider({ groups, focusedProvider: 'gemini' })).toBe('gemini');
  });

  test('falls back to the first group when the focused provider has none', () => {
    expect(highlightedProvider({ groups, focusedProvider: 'claude' })).toBe('codex');
    expect(highlightedProvider({ groups, focusedProvider: null })).toBe('codex');
  });

  test('returns null without groups', () => {
    expect(highlightedProvider({ groups: [], focusedProvider: 'claude' })).toBeNull();
  });
});

describe('formatResetIn', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const min = 60_000;

  test('formats minutes', () => {
    expect(formatResetIn({ resetsAt: at(45 * min), now })).toBe('em 45 min');
  });

  test('formats hours and minutes', () => {
    expect(formatResetIn({ resetsAt: at(135 * min), now })).toBe('em 2 h 15 min');
    expect(formatResetIn({ resetsAt: at(120 * min), now })).toBe('em 2 h');
  });

  test('formats days', () => {
    expect(formatResetIn({ resetsAt: at(3 * 24 * 60 * min + 5 * min), now })).toBe('em 3 d');
  });

  test('returns agora for past or current instants', () => {
    expect(formatResetIn({ resetsAt: at(-5 * min), now })).toBe('agora');
    expect(formatResetIn({ resetsAt: at(0), now })).toBe('agora');
  });

  test('returns null for null or invalid dates', () => {
    expect(formatResetIn({ resetsAt: null, now })).toBeNull();
    expect(formatResetIn({ resetsAt: 'nope', now })).toBeNull();
  });
});

describe('usageLevel', () => {
  test('applies thresholds', () => {
    expect(usageLevel(0)).toBe('ok');
    expect(usageLevel(69.9)).toBe('ok');
    expect(usageLevel(70)).toBe('warn');
    expect(usageLevel(90)).toBe('warn');
    expect(usageLevel(90.1)).toBe('critical');
  });
});
