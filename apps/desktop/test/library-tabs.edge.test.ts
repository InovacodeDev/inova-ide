import { describe, expect, test } from 'vitest';
import type { LibraryItem } from '../src/shared/api';
import {
  inovaFlowAction,
  itemsForTab,
  libraryTabCounts,
  libraryTabOf,
  type LibraryTabId,
} from '../src/renderer/library-state';

const CONNECTOR: LibraryItem = {
  kind: 'connector',
  id: 'inova-flow',
  name: 'Custom InovaFlow',
  label: 'Custom',
  description: null,
  enabled: false,
  source: 'created',
  updatedAt: '2026-11-24T00:00:00.000Z',
  definition: { type: 'http', url: 'https://example.com/mcp' },
};

describe('library tabs edge cases', () => {
  test('an empty library has empty tabs and zero counts', () => {
    for (const tab of ['skill', 'plugin', 'mcp'] as const) {
      expect(itemsForTab([], tab)).toEqual([]);
    }
    expect(libraryTabCounts([])).toEqual({ skill: 0, plugin: 0, mcp: 0 });
  });

  test('an unknown kind belongs to no tab', () => {
    expect(libraryTabOf('widget')).toBeNull();
    expect(libraryTabOf('')).toBeNull();
    expect(libraryTabOf('Skill')).toBeNull();
  });

  test('an unknown tab id returns no items', () => {
    expect(itemsForTab([CONNECTOR], 'nope' as LibraryTabId)).toEqual([]);
  });

  test('items of an unknown kind never reach a tab or a count', () => {
    const weird = { ...CONNECTOR, kind: 'widget' } as unknown as LibraryItem;
    expect(libraryTabCounts([weird])).toEqual({ skill: 0, plugin: 0, mcp: 0 });
  });

  test('the preset opens the existing item for edit when the id is taken', () => {
    const action = inovaFlowAction([CONNECTOR]);
    expect(action).toEqual({ kind: 'edit', item: CONNECTOR });
  });

  test('the preset ignores items with other ids', () => {
    expect(inovaFlowAction([{ ...CONNECTOR, id: 'other' }]).kind).toBe('new');
  });

  test('disabled items still count in their tab', () => {
    expect(libraryTabCounts([CONNECTOR]).mcp).toBe(1);
  });
});
