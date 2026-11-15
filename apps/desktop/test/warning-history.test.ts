import { describe, expect, test } from 'vitest';
import {
  WARNING_HISTORY_LIMIT,
  appendWarningEntry,
  type WarningEntry,
} from '../src/renderer/useWarning';

describe('appendWarningEntry', () => {
  test('prepends the newest entry at the top of history', () => {
    const first: WarningEntry = { id: 1, message: 'First', at: '2026-11-15T10:00:00.000Z' };
    const second: WarningEntry = { id: 2, message: 'Second', at: '2026-11-15T10:01:00.000Z' };
    const next = appendWarningEntry([first], second);
    expect(next).toEqual([second, first]);
  });

  test('caps retained history at WARNING_HISTORY_LIMIT', () => {
    let entries: WarningEntry[] = [];
    for (let i = 1; i <= WARNING_HISTORY_LIMIT + 5; i += 1) {
      entries = appendWarningEntry(entries, {
        id: i,
        message: `Alert ${i}`,
        at: '2026-11-15T10:00:00.000Z',
      });
    }
    expect(entries).toHaveLength(WARNING_HISTORY_LIMIT);
    expect(entries[0]?.id).toBe(WARNING_HISTORY_LIMIT + 5);
    expect(entries[WARNING_HISTORY_LIMIT - 1]?.id).toBe(6);
  });
});
