import { describe, expect, test } from 'vitest';
import type { LibraryItem } from '../src/shared/api';
import {
  CONNECTOR_CATALOG,
  CUSTOM_PRESET_ID,
  INOVA_FLOW_PRESET,
  inovaFlowAction,
  presetAction,
  presetHelp,
  searchConnectorPresets,
} from '../src/renderer/connector-catalog';
import { buildSaveInput } from '../src/renderer/library-form';

const EXPECTED_URLS: Record<string, string> = {
  'inova-flow': 'https://flow.inovacode.dev/api/v1/mcp',
  atlassian: 'https://mcp.atlassian.com/v2/mcp',
  figma: 'https://mcp.figma.com/mcp',
  linear: 'https://mcp.linear.app/mcp',
  notion: 'https://mcp.notion.com/mcp',
  sentry: 'https://mcp.sentry.dev/mcp',
  slack: 'https://mcp.slack.com/mcp',
  monday: 'https://mcp.monday.com/mcp',
  box: 'https://mcp.box.com',
  canva: 'https://mcp.canva.com/mcp',
  intercom: 'https://mcp.intercom.com/mcp',
  github: 'https://api.githubcopilot.com/mcp/',
};

function existing(id: string): LibraryItem {
  return {
    kind: 'connector',
    id,
    name: 'Mine',
    label: 'Mine',
    description: null,
    enabled: true,
    source: 'created',
    updatedAt: '2026-11-24T00:00:00.000Z',
    definition: { type: 'http', url: 'https://example.com/mcp' },
  };
}

describe('connector catalog', () => {
  test('lists the verified connectors with their URLs', () => {
    expect(Object.fromEntries(CONNECTOR_CATALOG.map((preset) => [preset.id, preset.url]))).toEqual(
      EXPECTED_URLS,
    );
  });

  test('token connectors reference an environment variable and OAuth connectors have none', () => {
    const flow = CONNECTOR_CATALOG.find((preset) => preset.id === 'inova-flow');
    const github = CONNECTOR_CATALOG.find((preset) => preset.id === 'github');
    expect(flow).toMatchObject({
      auth: 'token',
      envVar: 'INOVA_FLOW_TOKEN',
      headers: [{ key: 'Authorization', value: 'Bearer ${INOVA_FLOW_TOKEN}' }],
    });
    expect(github).toMatchObject({
      auth: 'token',
      envVar: 'GITHUB_PAT',
      headers: [{ key: 'Authorization', value: 'Bearer ${GITHUB_PAT}' }],
    });
    for (const preset of CONNECTOR_CATALOG.filter((entry) => entry.auth === 'oauth')) {
      expect('headers' in preset).toBe(false);
      expect('envVar' in preset).toBe(false);
    }
  });

  test('every preset opens a connector form that passes validation', () => {
    for (const preset of CONNECTOR_CATALOG) {
      const action = presetAction([], preset.id);
      expect(action?.kind).toBe('new');
      if (action?.kind !== 'new') continue;
      const built = buildSaveInput(action.form);
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      expect(built.input).toMatchObject({
        kind: 'connector',
        id: preset.id,
        definition: { type: 'http', url: preset.url },
      });
    }
  });

  test('a preset id that already exists opens that item for edit', () => {
    const item = existing('figma');
    expect(presetAction([item], 'figma')).toEqual({ kind: 'edit', item });
  });

  test('the custom preset opens an empty connector form', () => {
    const action = presetAction([existing('other')], CUSTOM_PRESET_ID);
    expect(action?.kind).toBe('new');
    if (action?.kind !== 'new') return;
    expect(action.form).toMatchObject({
      kind: 'connector',
      editing: false,
      id: '',
      url: '',
      headers: [],
      transport: 'http',
    });
  });

  test('help tells OAuth, token and custom connectors apart', () => {
    expect(presetHelp('linear')).toEqual({ kind: 'oauth' });
    expect(presetHelp('github')).toEqual({ kind: 'token', envVar: 'GITHUB_PAT' });
    expect(presetHelp(CUSTOM_PRESET_ID)).toEqual({ kind: 'custom' });
  });

  test('search finds a preset by name', () => {
    expect(searchConnectorPresets('notion').map((preset) => preset.id)).toEqual(['notion']);
  });

  test('the legacy InovaFlow exports derive from the catalog', () => {
    expect(INOVA_FLOW_PRESET.url).toBe(EXPECTED_URLS['inova-flow']);
    expect(INOVA_FLOW_PRESET.headerValue).toBe('Bearer ${INOVA_FLOW_TOKEN}');
    expect(inovaFlowAction([]).kind).toBe('new');
  });
});
