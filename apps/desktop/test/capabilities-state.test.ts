import { describe, expect, test } from 'vitest';
import type { CapabilityItem, CapabilityListing } from '../src/shared/api';
import {
  applyModeLabel,
  displayEnabled,
  filterItems,
  sortItems,
  visibleTabs,
} from '../src/renderer/capabilities-state';

function item(overrides: Partial<CapabilityItem>): CapabilityItem {
  return {
    kind: 'skill',
    id: 'id',
    name: 'name',
    description: null,
    source: 'user',
    enabled: true,
    applyMode: 'launch',
    unsupportedReason: null,
    tokens: null,
    group: null,
    ...overrides,
  };
}

describe('visibleTabs', () => {
  test('hides empty tabs and keeps tabs with an error', () => {
    const listing: CapabilityListing = {
      categories: [
        { kind: 'skill', items: [item({})], error: null },
        { kind: 'mcp', items: [], error: null },
        { kind: 'connector', items: [], error: 'CLI ausente' },
        { kind: 'plugin', items: [], error: null },
      ],
      cost: null,
    };
    expect(visibleTabs(listing)).toEqual(['skill', 'connector']);
  });
});

describe('sortItems', () => {
  test('orders by tokens desc and puts null last alphabetically', () => {
    const sorted = sortItems([
      item({ name: 'zeta' }),
      item({ name: 'small', tokens: 10 }),
      item({ name: 'alpha' }),
      item({ name: 'big', tokens: 500 }),
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual(['big', 'small', 'alpha', 'zeta']);
  });
});

describe('filterItems', () => {
  const items = [
    item({ name: 'Gmail', description: 'Email tools' }),
    item({ name: 'graft', description: 'Code graph' }),
  ];

  test('matches name and description ignoring case', () => {
    expect(filterItems({ items, query: 'GMAIL' }).map((entry) => entry.name)).toEqual(['Gmail']);
    expect(filterItems({ items, query: 'code' }).map((entry) => entry.name)).toEqual(['graft']);
  });

  test('returns every item for a blank query', () => {
    expect(filterItems({ items, query: '  ' })).toHaveLength(2);
  });
});

describe('applyModeLabel', () => {
  test('labels the four modes', () => {
    expect(applyModeLabel('launch')).toBe('Só no Inova');
    expect(applyModeLabel('account-file')).toBe('Na conta');
    expect(applyModeLabel('global-file')).toBe('Global');
    expect(applyModeLabel('unsupported')).toBe('Não configurável');
  });
});

describe('displayEnabled', () => {
  const disabledPlugin = item({
    kind: 'plugin',
    id: 'superpowers@market',
    name: 'Superpowers',
    enabled: false,
  });
  const grouped = item({ group: 'superpowers', applyMode: 'unsupported', enabled: true });

  test('shows a plugin skill as off when its plugin is disabled (id before @)', () => {
    expect(displayEnabled({ item: grouped, plugins: [disabledPlugin] })).toBe(false);
  });

  test('matches the plugin by name', () => {
    const byName = item({ group: 'Superpowers', applyMode: 'unsupported', enabled: true });
    expect(displayEnabled({ item: byName, plugins: [disabledPlugin] })).toBe(false);
  });

  test('uses the item state when no plugin matches or the item is not a plugin skill', () => {
    expect(displayEnabled({ item: grouped, plugins: [] })).toBe(true);
    const launchSkill = item({ group: 'superpowers', enabled: true });
    expect(displayEnabled({ item: launchSkill, plugins: [disabledPlugin] })).toBe(true);
  });
});
