import { describe, expect, test } from 'vitest';
import type { AccountView } from '../src/shared/api';
import {
  formatResetDateTime,
  formatResetIn,
  groupByProvider,
  highlightedProvider,
  orderedUsageWindows,
  primaryUsageWindows,
  providerHealth,
  usageLevel,
  usageWindowKey,
  usageWindowLabel,
} from '../src/renderer/footer-state';

const account = (
  label: string,
  provider: AccountView['provider'],
  status: AccountView['status'] = 'logged-in',
): AccountView => ({ id: label, label, email: null, provider, status });

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

describe('providerHealth', () => {
  test('is ok only when every account is logged in', () => {
    expect(providerHealth([account('a', 'claude'), account('b', 'claude')])).toEqual({
      kind: 'ok',
    });
  });

  test('counts accounts that are not logged in as pending', () => {
    expect(
      providerHealth([
        account('a', 'claude'),
        account('b', 'claude', 'logged-out'),
        account('c', 'claude', 'unknown'),
      ]),
    ).toEqual({ kind: 'pending', count: 2 });
  });

  test('reports a missing CLI before any pending login', () => {
    expect(
      providerHealth([
        account('a', 'codex', 'logged-out'),
        account('b', 'codex', 'binary-missing'),
      ]),
    ).toEqual({ kind: 'missing-cli' });
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

  test('omits days and formats hh"h" mm"min" when under 24 hours', () => {
    expect(formatResetIn({ resetsAt: at(45 * min), now })).toBe('00h 45min');
    expect(formatResetIn({ resetsAt: at(135 * min), now })).toBe('02h 15min');
    expect(formatResetIn({ resetsAt: at(120 * min), now })).toBe('02h 00min');
  });

  test('formats dd"d" hh"h" mm"min" when 1 day or more remains', () => {
    expect(formatResetIn({ resetsAt: at(27 * 60 * min), now })).toBe('01d 03h 00min');
    expect(formatResetIn({ resetsAt: at(3 * 24 * 60 * min + 5 * min), now })).toBe('03d 00h 05min');
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

describe('formatResetDateTime', () => {
  test('formats valid ISO instants as DD/MM HH:mm and returns null for invalid inputs', () => {
    const sample = new Date(2026, 10, 12, 9, 5, 0).toISOString();
    expect(formatResetDateTime(sample)).toBe('12/11 09:05');
    expect(formatResetDateTime(null)).toBeNull();
    expect(formatResetDateTime('invalid')).toBeNull();
  });
});

describe('orderedUsageWindows', () => {
  test('orders windows as session, weekly, monthly', () => {
    const result = orderedUsageWindows([
      { kind: 'monthly', usedPercent: 40, resetsAt: null },
      { kind: 'session', usedPercent: 10, resetsAt: null },
      { kind: 'weekly', usedPercent: 25, resetsAt: null },
    ]);
    expect(result.map((w) => w.kind)).toEqual(['session', 'weekly', 'monthly']);
  });

  test('lists unscoped windows first, then each scope in order of appearance', () => {
    const result = orderedUsageWindows([
      { kind: 'weekly', usedPercent: 100, resetsAt: null, scope: 'Argon' },
      { kind: 'weekly', usedPercent: 98, resetsAt: null },
      { kind: 'weekly', usedPercent: 50, resetsAt: null, scope: 'Claude and GPT' },
      { kind: 'session', usedPercent: 0, resetsAt: null, scope: 'Claude and GPT' },
      { kind: 'session', usedPercent: 0, resetsAt: null },
    ]);
    expect(result.map((w) => usageWindowKey(w))).toEqual([
      ':session',
      ':weekly',
      'Argon:weekly',
      'Claude and GPT:session',
      'Claude and GPT:weekly',
    ]);
  });
});

describe('primaryUsageWindows', () => {
  test('keeps only unscoped windows', () => {
    const result = primaryUsageWindows([
      { kind: 'weekly', usedPercent: 0, resetsAt: null, scope: 'Fable' },
      { kind: 'session', usedPercent: 5, resetsAt: null },
    ]);
    expect(result).toEqual([{ kind: 'session', usedPercent: 5, resetsAt: null }]);
  });
});

describe('usageWindowLabel', () => {
  const labels = { session: 'Sessão', weekly: 'Semana', monthly: 'Mês' };

  test('prefixes the scope when present', () => {
    expect(
      usageWindowLabel({
        window: { kind: 'weekly', usedPercent: 0, resetsAt: null, scope: 'Fable' },
        labels,
      }),
    ).toBe('Fable · Semana');
    expect(
      usageWindowLabel({ window: { kind: 'session', usedPercent: 0, resetsAt: null }, labels }),
    ).toBe('Sessão');
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
