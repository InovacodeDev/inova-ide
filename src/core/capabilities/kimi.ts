import { join } from 'node:path';
import { readIfExists, serialize, updateJsonFile } from './file-edit.js';
import { baseItem, isRecord } from './shared.js';
import type {
  CapabilityAdapter,
  CapabilityCategoryResult,
  CapabilityContext,
  CapabilityListing,
  SetEnabledInput,
} from './types.js';

const UNSUPPORTED_KIND_MESSAGE = 'Kimi não suporta desligar este item.';
const INVALID_MCP_MESSAGE = 'O mcp.json do Kimi é inválido.';

function mcpFile(ctx: CapabilityContext): string {
  return join(ctx.account.homeDir, 'mcp.json');
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function mcpCategory(ctx: CapabilityContext): Promise<CapabilityCategoryResult> {
  const raw = await readIfExists(mcpFile(ctx));
  if (raw === null) return { kind: 'mcp', items: [], error: null };
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) return { kind: 'mcp', items: [], error: INVALID_MCP_MESSAGE };
  const servers = isRecord(parsed['mcpServers']) ? parsed['mcpServers'] : {};
  const items = Object.entries(servers).map(([id, server]) =>
    baseItem({ kind: 'mcp', id, enabled: !(isRecord(server) && server['enabled'] === false) }),
  );
  return { kind: 'mcp', items, error: null };
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  return { categories: [await mcpCategory(ctx)], cost: null };
}

function setEnabled(input: SetEnabledInput): Promise<void> {
  const { ctx, ref, enabled } = input;
  if (ref.kind !== 'mcp') return Promise.reject(new Error(UNSUPPORTED_KIND_MESSAGE));
  const file = mcpFile(ctx);
  return serialize(file, () =>
    updateJsonFile({
      file,
      backupRoot: ctx.backupRoot,
      update: (root) => {
        const servers = isRecord(root['mcpServers']) ? root['mcpServers'] : {};
        const current = servers[ref.id];
        const { enabled: _previous, ...rest } = isRecord(current) ? current : {};
        const server = enabled ? rest : { ...rest, enabled: false };
        return { ...root, mcpServers: { ...servers, [ref.id]: server } };
      },
    }),
  );
}

export const kimiCapabilities: CapabilityAdapter = { list, launchArgs: () => [], setEnabled };
