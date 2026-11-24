import { describe, expect, test } from 'vitest';
import type { LibraryItem } from '../src/shared/api';
import {
  CONNECTOR_CATALOG,
  CUSTOM_PRESET_ID,
  PRESET_DESCRIPTION_KEYS,
  presetAction,
  presetHelp,
  searchConnectorPresets,
} from '../src/renderer/connector-catalog';
import { MESSAGES } from '../src/renderer/i18n';
import { isLibrarySlug, isVariableReference } from '../src/renderer/library-form';

const SKILL: LibraryItem = {
  kind: 'skill',
  id: 'figma',
  name: 'Figma skill',
  description: null,
  enabled: true,
  source: 'created',
  updatedAt: '2026-11-24T00:00:00.000Z',
  definition: { hash: 'a'.repeat(64) },
};

describe('connector catalog edge cases', () => {
  test('ids are unique slugs and the custom id is not a catalog id', () => {
    const ids = CONNECTOR_CATALOG.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isLibrarySlug(id)).toBe(true);
    expect(ids).not.toContain(CUSTOM_PRESET_ID);
  });

  test('every URL is https with no credentials, query or fragment', () => {
    for (const preset of CONNECTOR_CATALOG) {
      const url = new URL(preset.url);
      expect(url.protocol).toBe('https:');
      expect(url.username + url.password + url.search + url.hash).toBe('');
    }
  });

  test('header values are only variable references, never literal secrets', () => {
    for (const preset of CONNECTOR_CATALOG) {
      for (const row of 'headers' in preset ? preset.headers : []) {
        expect(isVariableReference(row.value)).toBe(true);
      }
    }
  });

  test('every preset has a description in both locales', () => {
    for (const preset of CONNECTOR_CATALOG) {
      const key = PRESET_DESCRIPTION_KEYS[preset.id];
      expect(MESSAGES['pt-BR'][key]).toBeTruthy();
      expect(MESSAGES['en-US'][key]).toBeTruthy();
    }
  });

  test('an unknown preset id returns null', () => {
    expect(presetAction([], 'nope')).toBeNull();
    expect(presetAction([], '')).toBeNull();
    expect(presetHelp('nope')).toEqual({ kind: 'custom' });
  });

  test('an existing item of another kind with the preset id still opens for edit', () => {
    expect(presetAction([SKILL], 'figma')).toEqual({ kind: 'edit', item: SKILL });
  });

  test('the custom preset ignores existing items and stays a new form', () => {
    expect(presetAction([SKILL], CUSTOM_PRESET_ID)?.kind).toBe('new');
  });

  test('editing a prefilled form does not change the catalog', () => {
    const action = presetAction([], 'github');
    if (action?.kind !== 'new') throw new Error('expected a new form');
    const row = action.form.headers[0];
    if (!row) throw new Error('expected a header row');
    row.value = 'Bearer changed';
    const fresh = presetAction([], 'github');
    if (fresh?.kind !== 'new') throw new Error('expected a new form');
    expect(fresh.form.headers).toEqual([{ key: 'Authorization', value: 'Bearer ${GITHUB_PAT}' }]);
  });

  test('search ignores case and surrounding spaces and matches the host', () => {
    expect(searchConnectorPresets('  FIGMA ').map((preset) => preset.id)).toEqual(['figma']);
    expect(searchConnectorPresets('githubcopilot').map((preset) => preset.id)).toEqual(['github']);
  });

  test('search with no match is empty and a blank query returns the catalog', () => {
    expect(searchConnectorPresets('zzz-nothing')).toEqual([]);
    expect(searchConnectorPresets('   ')).toHaveLength(CONNECTOR_CATALOG.length);
  });

  test('search treats regex characters as plain text', () => {
    expect(searchConnectorPresets('.*')).toEqual([]);
    expect(searchConnectorPresets('[')).toEqual([]);
    expect(searchConnectorPresets('(jira').map((preset) => preset.id)).toEqual(['atlassian']);
  });
});
