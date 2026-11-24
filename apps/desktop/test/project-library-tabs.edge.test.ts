import { describe, expect, test } from 'vitest';
import type { LibraryItem, ProjectLibraryBinding } from '../src/shared/api';
import { LIBRARY_TABS, projectTabState } from '../src/renderer/library-state';

const BASE = {
  description: null,
  enabled: true,
  source: 'created' as const,
  updatedAt: '2026-11-24T00:00:00.000Z',
};

const SKILL: LibraryItem = {
  ...BASE,
  kind: 'skill',
  id: 'review',
  name: 'Review',
  definition: { hash: 'a'.repeat(64) },
};
const SKILL_B: LibraryItem = { ...SKILL, id: 'audit', name: 'Audit' };
const PLUGIN: LibraryItem = {
  ...BASE,
  kind: 'plugin',
  id: 'tools',
  name: 'Tools',
  definition: { provider: 'claude', name: 'tools' },
};
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
const ITEMS = [SKILL, SKILL_B, PLUGIN, MCP, CONNECTOR];

describe('project library tabs', () => {
  test('the skill tab shows only skills, split into imported and available', () => {
    const bindings: ProjectLibraryBinding[] = [{ itemId: 'review', enabled: true }];
    const state = projectTabState({ items: ITEMS, bindings, tabId: 'skill' });
    expect(state.imported.map((row) => row.item.id)).toEqual(['review']);
    expect(state.available.map((item) => item.id)).toEqual(['audit']);
    expect(state.mcpRows).toEqual([]);
  });

  test('the plugin tab shows only plugins', () => {
    const state = projectTabState({ items: ITEMS, tabId: 'plugin' });
    expect(state.imported).toEqual([]);
    expect(state.available.map((item) => item.id)).toEqual(['tools']);
  });

  test('the mcp tab lists MCPs and connectors with the project override status', () => {
    const state = projectTabState({ items: ITEMS, projectDisabled: ['docs'], tabId: 'mcp' });
    expect(state.imported).toEqual([]);
    expect(state.available).toEqual([]);
    expect(state.mcpRows.map((row) => [row.item.id, row.status])).toEqual([
      ['local', 'effective'],
      ['docs', 'project-off'],
    ]);
  });

  test('a library-off item keeps its status in the tab', () => {
    const off = { ...MCP, enabled: false };
    const state = projectTabState({ items: [off], tabId: 'mcp' });
    expect(state.mcpRows[0]?.status).toBe('library-off');
  });

  test('a binding for an item of another tab does not leak into this tab', () => {
    const bindings: ProjectLibraryBinding[] = [{ itemId: 'tools', enabled: false }];
    const state = projectTabState({ items: ITEMS, bindings, tabId: 'skill' });
    expect(state.imported).toEqual([]);
    expect(state.available).toHaveLength(2);
  });

  test('an empty library gives empty tabs and every tab id has a state', () => {
    for (const tab of LIBRARY_TABS) {
      expect(projectTabState({ items: [], tabId: tab.id })).toEqual({
        imported: [],
        available: [],
        mcpRows: [],
      });
    }
  });
});
