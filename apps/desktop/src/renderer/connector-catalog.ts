import type { LibraryItem } from '../shared/api';
import type { TranslationKey } from './i18n';
import { emptyForm, type KeyValueRow, type LibraryFormState } from './library-form';

export type ConnectorAuth = 'oauth' | 'token';

export interface ConnectorPreset {
  id: string;
  name: string;
  label: string;
  /** Pt-BR text stored in the library item, like the other library descriptions. */
  description: string;
  url: string;
  transport: 'http';
  auth: ConnectorAuth;
  /** Headers with `${VAR}` placeholders. Only token connectors have them. */
  headers?: readonly KeyValueRow[];
  /** Environment variable the user must define. Only token connectors have one. */
  envVar?: string;
}

export const CUSTOM_PRESET_ID = 'custom';

export const CONNECTOR_CATALOG = [
  {
    id: 'inova-flow',
    name: 'InovaFlow',
    label: 'InovaFlow',
    description: 'Rastreador de tarefas InovaFlow (MCP remoto).',
    url: 'https://flow.inovacode.dev/api/v1/mcp',
    transport: 'http',
    auth: 'token',
    headers: [{ key: 'Authorization', value: 'Bearer ${INOVA_FLOW_TOKEN}' }],
    envVar: 'INOVA_FLOW_TOKEN',
  },
  {
    id: 'atlassian',
    name: 'Atlassian (Jira e Confluence)',
    label: 'Atlassian',
    description: 'Jira e Confluence (MCP remoto da Atlassian).',
    url: 'https://mcp.atlassian.com/v2/mcp',
    transport: 'http',
    auth: 'oauth',
  },
  {
    id: 'figma',
    name: 'Figma',
    label: 'Figma',
    description: 'Designs e componentes do Figma (MCP remoto).',
    url: 'https://mcp.figma.com/mcp',
    transport: 'http',
    auth: 'oauth',
  },
  {
    id: 'linear',
    name: 'Linear',
    label: 'Linear',
    description: 'Issues e projetos do Linear (MCP remoto).',
    url: 'https://mcp.linear.app/mcp',
    transport: 'http',
    auth: 'oauth',
  },
  {
    id: 'notion',
    name: 'Notion',
    label: 'Notion',
    description: 'Páginas e bancos de dados do Notion (MCP remoto).',
    url: 'https://mcp.notion.com/mcp',
    transport: 'http',
    auth: 'oauth',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    label: 'Sentry',
    description: 'Erros e performance do Sentry (MCP remoto).',
    url: 'https://mcp.sentry.dev/mcp',
    transport: 'http',
    auth: 'oauth',
  },
  {
    id: 'slack',
    name: 'Slack',
    label: 'Slack',
    description: 'Canais e mensagens do Slack (MCP remoto).',
    url: 'https://mcp.slack.com/mcp',
    transport: 'http',
    auth: 'oauth',
  },
  {
    id: 'monday',
    name: 'monday.com',
    label: 'monday.com',
    description: 'Quadros e itens do monday.com (MCP remoto).',
    url: 'https://mcp.monday.com/mcp',
    transport: 'http',
    auth: 'oauth',
  },
  {
    id: 'box',
    name: 'Box',
    label: 'Box',
    description: 'Arquivos e pastas do Box (MCP remoto).',
    url: 'https://mcp.box.com',
    transport: 'http',
    auth: 'oauth',
  },
  {
    id: 'canva',
    name: 'Canva',
    label: 'Canva',
    description: 'Designs do Canva (MCP remoto).',
    url: 'https://mcp.canva.com/mcp',
    transport: 'http',
    auth: 'oauth',
  },
  {
    id: 'intercom',
    name: 'Intercom',
    label: 'Intercom',
    description: 'Conversas e contatos do Intercom (MCP remoto).',
    url: 'https://mcp.intercom.com/mcp',
    transport: 'http',
    auth: 'oauth',
  },
  {
    id: 'github',
    name: 'GitHub',
    label: 'GitHub',
    description: 'Repositórios, issues e PRs do GitHub (MCP remoto).',
    url: 'https://api.githubcopilot.com/mcp/',
    transport: 'http',
    auth: 'token',
    headers: [{ key: 'Authorization', value: 'Bearer ${GITHUB_PAT}' }],
    envVar: 'GITHUB_PAT',
  },
] as const satisfies readonly ConnectorPreset[];

export type CatalogPresetId = (typeof CONNECTOR_CATALOG)[number]['id'];

export const PRESET_DESCRIPTION_KEYS: Readonly<Record<CatalogPresetId, TranslationKey>> = {
  'inova-flow': 'connectors.preset.inova-flow.desc',
  atlassian: 'connectors.preset.atlassian.desc',
  figma: 'connectors.preset.figma.desc',
  linear: 'connectors.preset.linear.desc',
  notion: 'connectors.preset.notion.desc',
  sentry: 'connectors.preset.sentry.desc',
  slack: 'connectors.preset.slack.desc',
  monday: 'connectors.preset.monday.desc',
  box: 'connectors.preset.box.desc',
  canva: 'connectors.preset.canva.desc',
  intercom: 'connectors.preset.intercom.desc',
  github: 'connectors.preset.github.desc',
};

export function findConnectorPreset(id: string): ConnectorPreset | undefined {
  return CONNECTOR_CATALOG.find((preset) => preset.id === id);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Case-insensitive match on name, id and host. An empty query returns the whole catalog. */
export function searchConnectorPresets(query: string): ConnectorPreset[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...CONNECTOR_CATALOG];
  return CONNECTOR_CATALOG.filter((preset) =>
    [preset.name, preset.label, preset.id, hostOf(preset.url)].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

export type PresetAction =
  { kind: 'new'; form: LibraryFormState } | { kind: 'edit'; item: LibraryItem };

function formFromPreset(preset: ConnectorPreset): LibraryFormState {
  return {
    ...emptyForm('connector'),
    id: preset.id,
    name: preset.name,
    label: preset.label,
    description: preset.description,
    transport: preset.transport,
    url: preset.url,
    headers: (preset.headers ?? []).map((row) => ({ ...row })),
  };
}

/**
 * Decides what the "add connector" picker does for a preset. An item that already uses the
 * preset id opens for edit. The custom preset always opens an empty connector form.
 * Returns null when the id is neither custom nor in the catalog.
 */
export function presetAction(items: readonly LibraryItem[], presetId: string): PresetAction | null {
  if (presetId === CUSTOM_PRESET_ID) return { kind: 'new', form: emptyForm('connector') };
  const preset = findConnectorPreset(presetId);
  if (!preset) return null;
  const existing = items.find((item) => item.id === preset.id);
  if (existing) return { kind: 'edit', item: existing };
  return { kind: 'new', form: formFromPreset(preset) };
}

export type PresetHelp = { kind: 'oauth' } | { kind: 'token'; envVar: string } | { kind: 'custom' };

export function presetHelp(presetId: string): PresetHelp {
  const preset = findConnectorPreset(presetId);
  if (!preset) return { kind: 'custom' };
  if (preset.auth === 'token') return { kind: 'token', envVar: preset.envVar ?? '' };
  return { kind: 'oauth' };
}

const INOVA_FLOW = CONNECTOR_CATALOG[0];

/** Kept for backward compatibility. Derived from the catalog entry. */
export const INOVA_FLOW_PRESET = {
  id: INOVA_FLOW.id,
  name: INOVA_FLOW.name,
  label: INOVA_FLOW.label,
  description: INOVA_FLOW.description,
  url: INOVA_FLOW.url,
  headerKey: INOVA_FLOW.headers[0].key,
  headerValue: INOVA_FLOW.headers[0].value,
} as const;

export type InovaFlowAction = PresetAction;

export function inovaFlowAction(items: readonly LibraryItem[]): InovaFlowAction {
  const action = presetAction(items, INOVA_FLOW.id);
  if (!action) throw new Error('InovaFlow preset missing from the catalog');
  return action;
}
