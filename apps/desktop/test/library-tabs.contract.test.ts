import { describe, expect, test } from 'vitest';
import type { LibraryItem } from '../src/shared/api';
import { buildSaveInput } from '../src/renderer/library-form';
import {
  INOVA_FLOW_PRESET,
  LIBRARY_TABS,
  inovaFlowAction,
  itemsForTab,
  libraryTabCounts,
  libraryTabOf,
} from '../src/renderer/library-state';

const BASE = {
  description: null,
  enabled: true,
  source: 'created' as const,
  updatedAt: '2026-11-24T00:00:00.000Z',
};

const SKILL: LibraryItem = {
  ...BASE,
  kind: 'skill',
  id: 'zeta-skill',
  name: 'Zeta',
  definition: { hash: 'a'.repeat(64) },
};
const SKILL_A: LibraryItem = { ...SKILL, id: 'alpha-skill', name: 'Alpha' };
const MCP: LibraryItem = {
  ...BASE,
  kind: 'mcp',
  id: 'local',
  name: 'Local',
  definition: { command: 'npx' },
};
const CONNECTOR: LibraryItem = {
  ...BASE,
  kind: 'connector',
  id: 'docs',
  name: 'Docs',
  label: 'Docs',
  definition: { type: 'http', url: 'https://example.com/mcp' },
};
const PLUGIN: LibraryItem = {
  ...BASE,
  kind: 'plugin',
  id: 'tools',
  name: 'Tools',
  definition: { provider: 'claude', name: 'tools' },
};

describe('library tabs', () => {
  test('exposes Skills, Plugins and MCPs in order', () => {
    expect(LIBRARY_TABS.map((tab) => tab.id)).toEqual(['skill', 'plugin', 'mcp']);
  });

  test('maps each kind to its tab', () => {
    expect(libraryTabOf('skill')).toBe('skill');
    expect(libraryTabOf('plugin')).toBe('plugin');
    expect(libraryTabOf('mcp')).toBe('mcp');
    expect(libraryTabOf('connector')).toBe('mcp');
  });

  test('itemsForTab returns only the items of the tab, sorted by name', () => {
    const items = [SKILL, PLUGIN, CONNECTOR, MCP, SKILL_A];
    expect(itemsForTab(items, 'skill').map((item) => item.id)).toEqual([
      'alpha-skill',
      'zeta-skill',
    ]);
    expect(itemsForTab(items, 'plugin').map((item) => item.id)).toEqual(['tools']);
    expect(itemsForTab(items, 'mcp').map((item) => item.id)).toEqual(['local', 'docs']);
  });

  test('counts items per tab', () => {
    expect(libraryTabCounts([SKILL, SKILL_A, PLUGIN, CONNECTOR, MCP])).toEqual({
      skill: 2,
      plugin: 1,
      mcp: 2,
    });
  });
});

describe('InovaFlow preset', () => {
  test('opens the connector form prefilled with a secret reference', () => {
    const action = inovaFlowAction([]);
    expect(action.kind).toBe('new');
    if (action.kind !== 'new') return;
    expect(action.form).toMatchObject({
      kind: 'connector',
      editing: false,
      id: 'inova-flow',
      name: 'InovaFlow',
      label: 'InovaFlow',
      transport: 'http',
      url: 'https://flow.inovacode.dev/api/v1/mcp',
      headers: [{ key: 'Authorization', value: 'Bearer ${INOVA_FLOW_TOKEN}' }],
    });
    expect(INOVA_FLOW_PRESET.headerValue).toBe('Bearer ${INOVA_FLOW_TOKEN}');
  });

  test('the prefilled form passes validation without a plain-text token', () => {
    const action = inovaFlowAction([]);
    if (action.kind !== 'new') throw new Error('expected a new form');
    const built = buildSaveInput(action.form);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input).toMatchObject({
      kind: 'connector',
      id: 'inova-flow',
      definition: {
        type: 'http',
        url: 'https://flow.inovacode.dev/api/v1/mcp',
        headers: { Authorization: 'Bearer ${INOVA_FLOW_TOKEN}' },
      },
    });
  });
});
