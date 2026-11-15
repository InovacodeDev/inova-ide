import { join } from 'node:path';
import { readIfExists } from './file-edit.js';
import { baseItem, isRecord } from './shared.js';
import type {
  CapabilityAdapter,
  CapabilityCategoryResult,
  CapabilityContext,
  CapabilityItem,
  CapabilityListing,
} from './types.js';

const NO_HOME_MESSAGE = 'HOME não definido.';
const INVALID_CONFIG_MESSAGE = 'O opencode.json do OpenCode é inválido.';
const UNSUPPORTED_KIND_MESSAGE = 'OpenCode não suporta desligar este item.';

type Config = Record<string, unknown>;

function openCodeDir(ctx: CapabilityContext): string | null {
  const home = ctx.env['HOME'];
  return home === undefined ? null : join(home, '.config', 'opencode');
}

async function readConfig(dir: string): Promise<Config | null> {
  const raw = await readIfExists(join(dir, 'opencode.json'));
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function globalItem(item: CapabilityItem): CapabilityItem {
  return { ...item, applyMode: 'global-file' };
}

function mcpItems(config: Config): CapabilityItem[] {
  const servers = isRecord(config['mcp']) ? config['mcp'] : {};
  return Object.entries(servers).map(([id, server]) =>
    globalItem(
      baseItem({ kind: 'mcp', id, enabled: !(isRecord(server) && server['disabled'] === true) }),
    ),
  );
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const dir = openCodeDir(ctx);
  const failed = (error: string): CapabilityListing => ({
    categories: [{ kind: 'mcp', items: [], error }],
    cost: null,
  });
  if (dir === null) return failed(NO_HOME_MESSAGE);
  const config = await readConfig(dir);
  if (config === null) return failed(INVALID_CONFIG_MESSAGE);
  const mcp: CapabilityCategoryResult = { kind: 'mcp', items: mcpItems(config), error: null };
  return { categories: [mcp], cost: null };
}

function setEnabled(): Promise<void> {
  return Promise.reject(new Error(UNSUPPORTED_KIND_MESSAGE));
}

export const opencodeCapabilities: CapabilityAdapter = {
  list,
  launchArgs: () => [],
  setEnabled,
};
