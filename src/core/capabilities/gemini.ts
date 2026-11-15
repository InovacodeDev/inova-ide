import type { CommandRunner } from '../providers.js';
import { serialize } from './file-edit.js';
import { baseItem, category, isRecord, parseJson } from './shared.js';
import type {
  CapabilityAdapter,
  CapabilityContext,
  CapabilityItem,
  CapabilityListing,
  SetEnabledInput,
} from './types.js';

const COMMAND_TIMEOUT_MS = 30_000;
const NOT_FOUND_MESSAGE = 'agy não encontrado.';
const MCP_LIST_FAILED_MESSAGE = 'Não foi possível listar os servidores MCP do agy.';
const PLUGIN_LIST_FAILED_MESSAGE = 'Não foi possível listar os plugins do agy.';
const SKILL_LIST_FAILED_MESSAGE = 'Não foi possível listar as skills do agy.';
const MCP_TABLE_HEADER = /^NAME\s+TYPE\s+STATUS\b/;
const MCP_EMPTY_MESSAGE = 'No MCP servers configured.';

export function parseMcpItems(stdout: string): CapabilityItem[] | null {
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

function skillItems(plugins: Record<string, unknown>[]): CapabilityItem[] {
  return plugins.flatMap((plugin) => {
    const pluginName = String(plugin['name']);
    const skills = Array.isArray(plugin['skills']) ? plugin['skills'] : [];
    return skills.flatMap((skill: unknown): CapabilityItem[] =>
      typeof skill === 'string'
        ? [
            {
              ...baseItem({
                kind: 'skill',
                id: `${pluginName}:${skill}`,
                enabled: plugin['enabled'] !== false,
              }),
              name: skill,
              source: 'plugin',
              applyMode: 'unsupported',
              unsupportedReason: `Desligue o plugin ${pluginName}`,
              group: pluginName,
            },
          ]
        : [],
    );
  });
}

function runAgy(ctx: CapabilityContext, args: string[]): ReturnType<CommandRunner['run']> {
  return ctx.runner.run({ command: 'agy', args, env: ctx.env, timeoutMs: COMMAND_TIMEOUT_MS });
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const [mcp, plugins] = await Promise.all([
    runAgy(ctx, ['mcp', 'list']),
    runAgy(ctx, ['plugin', 'list', '--json']),
  ]);
  if (!('exitCode' in mcp) || !('exitCode' in plugins)) {
    const kinds = ['skill', 'mcp', 'plugin'] as const;
    return {
      categories: kinds.map((kind) => ({ kind, items: [], error: NOT_FOUND_MESSAGE })),
      cost: null,
    };
  }
  const parsedPlugins = plugins.exitCode === 0 ? parsePlugins(plugins.stdout) : null;
  return {
    categories: [
      category({
        kind: 'skill',
        items: parsedPlugins === null ? null : skillItems(parsedPlugins),
        error: SKILL_LIST_FAILED_MESSAGE,
      }),
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

async function setEnabled(input: SetEnabledInput): Promise<void> {
  const { ctx, ref, enabled } = input;
  if (ref.kind !== 'mcp' && ref.kind !== 'plugin') {
    throw new Error(`Desligue o plugin que contém ${ref.id}.`);
  }
  const result = await serialize(`agy:${ctx.account.id}`, () =>
    runAgy(ctx, [ref.kind, enabled ? 'enable' : 'disable', ref.id]),
  );
  if (!('exitCode' in result)) throw new Error(NOT_FOUND_MESSAGE);
  if (result.exitCode !== 0) {
    throw new Error(`Falha ao ${enabled ? 'ligar' : 'desligar'} ${ref.id}.`);
  }
}

export const geminiCapabilities: CapabilityAdapter = {
  list,
  launchArgs: () => [],
  setEnabled,
};
