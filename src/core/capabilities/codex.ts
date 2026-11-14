import { join } from 'node:path';
import type { CommandRunner } from '../providers.js';
import {
  serialize,
  setTomlSkillConfig,
  setTomlTableKey,
  tomlTableHeader,
  updateTomlFile,
} from './file-edit.js';
import type {
  CapabilityAdapter,
  CapabilityCategoryResult,
  CapabilityContext,
  CapabilityItem,
  CapabilityListing,
  CapabilityRef,
  SetEnabledInput,
} from './types.js';

const COMMAND_TIMEOUT_MS = 30_000;
const NOT_FOUND_MESSAGE = 'codex não encontrado.';
const MCP_LIST_FAILED_MESSAGE = 'Não foi possível listar os servidores MCP do Codex.';
const PLUGIN_LIST_FAILED_MESSAGE = 'Não foi possível listar os plugins do Codex.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDisabled(disabled: readonly CapabilityRef[], ref: CapabilityRef): boolean {
  return disabled.some((entry) => entry.kind === ref.kind && entry.id === ref.id);
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function parseMcpItems(
  stdout: string,
  disabled: readonly CapabilityRef[],
): CapabilityItem[] | null {
  const parsed = parseJson(stdout);
  if (!Array.isArray(parsed)) return null;
  return parsed.flatMap((entry: unknown): CapabilityItem[] => {
    if (!isRecord(entry) || typeof entry['name'] !== 'string') return [];
    const id = entry['name'];
    return [
      {
        kind: 'mcp',
        id,
        name: id,
        description: null,
        source: 'user',
        enabled: entry['enabled'] !== false && !isDisabled(disabled, { kind: 'mcp', id }),
        applyMode: 'launch',
        unsupportedReason: null,
        tokens: null,
        group: null,
      },
    ];
  });
}

function parsePluginItems(stdout: string): CapabilityItem[] | null {
  const parsed = parseJson(stdout);
  if (!isRecord(parsed) || !Array.isArray(parsed['installed'])) return null;
  return parsed['installed'].flatMap((entry: unknown): CapabilityItem[] => {
    if (!isRecord(entry) || typeof entry['pluginId'] !== 'string') return [];
    const id = entry['pluginId'];
    return [
      {
        kind: 'plugin',
        id,
        name: typeof entry['name'] === 'string' ? entry['name'] : id,
        description: null,
        source: 'plugin',
        enabled: entry['enabled'] !== false,
        applyMode: 'account-file',
        unsupportedReason: null,
        tokens: null,
        group: null,
      },
    ];
  });
}

function runCodex(ctx: CapabilityContext, args: string[]): ReturnType<CommandRunner['run']> {
  return ctx.runner.run({ command: 'codex', args, env: ctx.env, timeoutMs: COMMAND_TIMEOUT_MS });
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
    runCodex(ctx, ['mcp', 'list', '--json']),
    runCodex(ctx, ['plugin', 'list', '--json']),
  ]);
  if (!('exitCode' in mcp) || !('exitCode' in plugins)) {
    const kinds = ['mcp', 'plugin'] as const;
    return {
      categories: kinds.map((kind) => ({ kind, items: [], error: NOT_FOUND_MESSAGE })),
      cost: null,
    };
  }
  const disabled = ctx.account.disabledCapabilities ?? [];
  return {
    categories: [
      category({
        kind: 'mcp',
        items: mcp.exitCode === 0 ? parseMcpItems(mcp.stdout, disabled) : null,
        error: MCP_LIST_FAILED_MESSAGE,
      }),
      category({
        kind: 'plugin',
        items: plugins.exitCode === 0 ? parsePluginItems(plugins.stdout) : null,
        error: PLUGIN_LIST_FAILED_MESSAGE,
      }),
    ],
    cost: null,
  };
}

function launchArgs(disabled: readonly CapabilityRef[]): string[] {
  return disabled
    .filter((ref) => ref.kind === 'mcp')
    .flatMap((ref) => ['-c', `${tomlTableHeader(['mcp_servers', ref.id])}.enabled=false`]);
}

function tomlUpdateFor(input: SetEnabledInput): ((toml: string) => string) | null {
  const { ref, enabled } = input;
  if (ref.kind === 'plugin') {
    const table = tomlTableHeader(['plugins', ref.id]);
    return (toml) => setTomlTableKey({ toml, table, key: 'enabled', value: enabled });
  }
  if (ref.kind === 'skill') {
    return (toml) => setTomlSkillConfig({ toml, name: ref.id, enabled });
  }
  return null;
}

function setEnabled(input: SetEnabledInput): Promise<void> {
  const update = tomlUpdateFor(input);
  if (update === null) return Promise.reject(new Error('MCP do Codex usa só o modo launch.'));
  const file = join(input.ctx.account.homeDir, 'config.toml');
  return serialize(file, () => updateTomlFile({ file, backupRoot: input.ctx.backupRoot, update }));
}

export const codexCapabilities: CapabilityAdapter = { list, launchArgs, setEnabled };
