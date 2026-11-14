import { join } from 'node:path';
import { readIfExists } from './file-edit.js';
import type {
  CapabilityAdapter,
  CapabilityContext,
  CapabilityItem,
  CapabilityListing,
  SetEnabledInput,
} from './types.js';

const INVALID_SETTINGS_MESSAGE = 'O settings.json do Qwen é inválido.';

type Settings = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function settingsFile(ctx: CapabilityContext): string {
  return join(ctx.account.homeDir, '.qwen', 'settings.json');
}

async function readSettings(ctx: CapabilityContext): Promise<Settings | null> {
  const raw = await readIfExists(settingsFile(ctx));
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function stringList(parent: unknown, key: string): string[] {
  const list = isRecord(parent) ? parent[key] : undefined;
  return Array.isArray(list)
    ? list.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function item(
  input: Pick<CapabilityItem, 'kind' | 'id' | 'enabled' | 'description'>,
): CapabilityItem {
  return {
    ...input,
    name: input.id,
    source: 'user',
    applyMode: 'account-file',
    unsupportedReason: null,
    tokens: null,
    group: null,
  };
}

function mcpItems(settings: Settings): CapabilityItem[] {
  const excluded = stringList(settings['mcp'], 'excluded');
  const servers = isRecord(settings['mcpServers']) ? Object.keys(settings['mcpServers']) : [];
  return servers.map((id) =>
    item({ kind: 'mcp', id, enabled: !excluded.includes(id), description: null }),
  );
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const settings = await readSettings(ctx);
  if (settings === null) {
    return {
      categories: [{ kind: 'mcp', items: [], error: INVALID_SETTINGS_MESSAGE }],
      cost: null,
    };
  }
  return { categories: [{ kind: 'mcp', items: mcpItems(settings), error: null }], cost: null };
}

export const qwenCapabilities: CapabilityAdapter = {
  list,
  launchArgs: () => [],
  setEnabled: (input: SetEnabledInput) =>
    Promise.reject(new Error(`Falha ao desligar ${input.ref.id}.`)),
};
