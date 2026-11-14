import type { CommandRunner } from '../providers.js';
import type {
  CapabilityAdapter,
  CapabilityCategoryResult,
  CapabilityContext,
  CapabilityItem,
  CapabilityListing,
  SetEnabledInput,
} from './types.js';

const COMMAND_TIMEOUT_MS = 30_000;
const NOT_FOUND_MESSAGE = 'agy não encontrado.';
const MCP_LIST_FAILED_MESSAGE = 'Não foi possível listar os servidores MCP do agy.';
const PLUGIN_LIST_FAILED_MESSAGE = 'Não foi possível listar os plugins do agy.';
const MCP_TABLE_HEADER = /^NAME\s+TYPE\s+STATUS\b/;
const MCP_EMPTY_MESSAGE = 'No MCP servers configured.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function baseItem(input: Pick<CapabilityItem, 'kind' | 'id' | 'enabled'>): CapabilityItem {
  return {
    ...input,
    name: input.id,
    description: null,
    source: 'user',
    applyMode: 'account-file',
    unsupportedReason: null,
    tokens: null,
    group: null,
  };
}

function parseMcpItems(stdout: string): CapabilityItem[] | null {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 1 && lines[0] === MCP_EMPTY_MESSAGE) return [];
  const [header, ...rows] = lines;
  if (header === undefined || !MCP_TABLE_HEADER.test(header)) return null;
  return rows.flatMap((row): CapabilityItem[] => {
    const [id, , status] = row.split(/\s+/);
    if (id === undefined || status === undefined) return [];
    return [baseItem({ kind: 'mcp', id, enabled: status !== 'disabled' })];
  });
}

function parsePlugins(stdout: string): Record<string, unknown>[] | null {
  const parsed = parseJson(stdout);
  if (!Array.isArray(parsed)) return null;
  return parsed.filter(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && typeof entry['name'] === 'string',
  );
}

function pluginItems(plugins: Record<string, unknown>[]): CapabilityItem[] {
  return plugins.map((plugin) =>
    baseItem({
      kind: 'plugin',
      id: String(plugin['name']),
      enabled: plugin['enabled'] !== false,
    }),
  );
}

function runAgy(ctx: CapabilityContext, args: string[]): ReturnType<CommandRunner['run']> {
  return ctx.runner.run({ command: 'agy', args, env: ctx.env, timeoutMs: COMMAND_TIMEOUT_MS });
}

function category(input: {
  kind: CapabilityCategoryResult['kind'];
  items: CapabilityItem[] | null;
  error: string;
}): CapabilityCategoryResult {
  return input.items === null
    ? { kind: input.kind, items: [], error: input.error }
    : { kind: input.kind, items: input.items, error: null };
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const [mcp, plugins] = await Promise.all([
    runAgy(ctx, ['mcp', 'list']),
    runAgy(ctx, ['plugin', 'list', '--json']),
  ]);
  if (!('exitCode' in mcp) || !('exitCode' in plugins)) {
    const kinds = ['mcp', 'plugin'] as const;
    return {
      categories: kinds.map((kind) => ({ kind, items: [], error: NOT_FOUND_MESSAGE })),
      cost: null,
    };
  }
  const parsedPlugins = plugins.exitCode === 0 ? parsePlugins(plugins.stdout) : null;
  return {
    categories: [
      category({
        kind: 'mcp',
        items: mcp.exitCode === 0 ? parseMcpItems(mcp.stdout) : null,
        error: MCP_LIST_FAILED_MESSAGE,
      }),
      category({
        kind: 'plugin',
        items: parsedPlugins === null ? null : pluginItems(parsedPlugins),
        error: PLUGIN_LIST_FAILED_MESSAGE,
      }),
    ],
    cost: null,
  };
}

export const geminiCapabilities: CapabilityAdapter = {
  list,
  launchArgs: () => [],
  setEnabled: (input: SetEnabledInput) =>
    Promise.reject(new Error(`Falha ao desligar ${input.ref.id}.`)),
};
