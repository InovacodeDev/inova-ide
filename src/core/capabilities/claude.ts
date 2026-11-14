import type { ContextBreakdown } from '../chat-types.js';
import { parseClaudeContextOutput } from '../context-report.js';
import type { CommandRunner } from '../providers.js';
import type {
  CapabilityAdapter,
  CapabilityContext,
  CapabilityCostSummary,
  CapabilityItem,
  CapabilityListing,
  CapabilityRef,
} from './types.js';

const COMMAND_TIMEOUT_MS = 30_000;
const CONNECTOR_PREFIX = 'claude.ai ';
const ALL_CONNECTORS_ID = '*';
// REGEX: "<name>: <command or url> - <status>" from `claude mcp list`; the name ends at the first ": "
const MCP_LINE_PATTERN = /^(.+?): .+ - .+$/;
// REGEX: skill Source column "Plugin (<plugin>)" captures the plugin name
const PLUGIN_SOURCE_PATTERN = /^Plugin \((.+)\)$/;

export function normalizeMcpName(name: string): string {
  return name.replaceAll(/[^A-Za-z0-9_-]/g, '_');
}

function isDisabled(disabled: readonly CapabilityRef[], ref: CapabilityRef): boolean {
  return disabled.some((entry) => entry.kind === ref.kind && entry.id === ref.id);
}

function parseMcpNames(stdout: string): string[] {
  return stdout.split('\n').flatMap((line) => {
    const match = MCP_LINE_PATTERN.exec(line.trim());
    return match?.[1] === undefined ? [] : [match[1]];
  });
}

function serverTokens(breakdown: ContextBreakdown): Map<string, number> {
  const totals = new Map<string, number>();
  const section = breakdown.sections.find((entry) => entry.title === 'MCP Tools');
  for (const row of section?.rows ?? []) {
    const server = row.cells[1];
    if (server === undefined || row.tokens === null) continue;
    totals.set(server, (totals.get(server) ?? 0) + row.tokens);
  }
  return totals;
}

function serverItems(input: {
  names: readonly string[];
  tokens: Map<string, number> | null;
  disabled: readonly CapabilityRef[];
}): { mcp: CapabilityItem[]; connectors: CapabilityItem[] } {
  const allConnectorsOff = isDisabled(input.disabled, {
    kind: 'connector',
    id: ALL_CONNECTORS_ID,
  });
  const mcp: CapabilityItem[] = [];
  const connectors: CapabilityItem[] = [];
  for (const name of input.names) {
    const isConnector = name.startsWith(CONNECTOR_PREFIX);
    const kind = isConnector ? 'connector' : 'mcp';
    const tokens = input.tokens?.get(normalizeMcpName(name)) ?? null;
    const item: CapabilityItem = {
      kind,
      id: name,
      name,
      description: null,
      source: isConnector ? 'connector' : 'user',
      enabled:
        !(isConnector && allConnectorsOff) && !isDisabled(input.disabled, { kind, id: name }),
      applyMode: 'launch',
      unsupportedReason: null,
      tokens,
      group: null,
    };
    (isConnector ? connectors : mcp).push(item);
  }
  return { mcp, connectors };
}

function skillItems(
  breakdown: ContextBreakdown,
  disabled: readonly CapabilityRef[],
): CapabilityItem[] {
  const section = breakdown.sections.find((entry) => entry.title === 'Skills');
  return (section?.rows ?? []).flatMap((row): CapabilityItem[] => {
    const [id, source = ''] = row.cells;
    if (id === undefined) return [];
    const plugin = PLUGIN_SOURCE_PATTERN.exec(source)?.[1];
    const base = { kind: 'skill', id, name: id, description: null, tokens: row.tokens } as const;
    if (plugin !== undefined) {
      return [
        {
          ...base,
          source: 'plugin',
          enabled: true,
          applyMode: 'unsupported',
          unsupportedReason: `Desligue o plugin ${plugin}`,
          group: plugin,
        },
      ];
    }
    return [
      {
        ...base,
        source: source === 'Built-in' ? 'bundled' : 'user',
        enabled: !isDisabled(disabled, { kind: 'skill', id }),
        applyMode: 'launch',
        unsupportedReason: null,
        group: null,
      },
    ];
  });
}

function categoryTokens(breakdown: ContextBreakdown, name: string): number | null {
  return breakdown.categories.find((entry) => entry.name === name)?.tokens ?? null;
}

function costSummary(breakdown: ContextBreakdown | null): CapabilityCostSummary | null {
  if (breakdown === null) return null;
  return {
    loadedTokens: categoryTokens(breakdown, 'MCP tools'),
    instructionTokens: categoryTokens(breakdown, 'MCP server instructions'),
    deferredTokens: categoryTokens(breakdown, 'MCP tools (deferred)'),
  };
}

function runClaude(
  ctx: CapabilityContext,
  command: { args: string[]; cwd?: string },
): ReturnType<CommandRunner['run']> {
  return ctx.runner.run({
    command: 'claude',
    args: command.args,
    env: ctx.env,
    cwd: command.cwd,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const [context, mcp] = await Promise.all([
    runClaude(ctx, {
      args: ['-p', '--output-format', 'json', '--no-session-persistence', '--', '/context'],
      cwd: ctx.projectPath ?? ctx.account.homeDir,
    }),
    runClaude(ctx, { args: ['mcp', 'list'] }),
  ]);
  const breakdown =
    'exitCode' in context && context.exitCode === 0
      ? parseClaudeContextOutput(context.stdout)
      : null;
  const disabled = ctx.account.disabledCapabilities ?? [];
  const servers = serverItems({
    names: 'exitCode' in mcp ? parseMcpNames(mcp.stdout) : [],
    tokens: breakdown === null ? null : serverTokens(breakdown),
    disabled,
  });
  return {
    categories: [
      {
        kind: 'skill',
        items: breakdown === null ? [] : skillItems(breakdown, disabled),
        error: null,
      },
      { kind: 'mcp', items: servers.mcp, error: null },
      { kind: 'connector', items: servers.connectors, error: null },
    ],
    cost: costSummary(breakdown),
  };
}

function launchArgs(disabled: readonly CapabilityRef[]): string[] {
  if (disabled.length === 0) return [];
  const allConnectorsOff = isDisabled(disabled, { kind: 'connector', id: ALL_CONNECTORS_ID });
  const deny: string[] = [];
  const skillOverrides: Record<string, 'off'> = {};
  const enabledPlugins: Record<string, false> = {};
  for (const ref of disabled) {
    if (ref.kind === 'skill') skillOverrides[ref.id] = 'off';
    else if (ref.kind === 'plugin') enabledPlugins[ref.id] = false;
    else if (ref.kind === 'mcp' || !allConnectorsOff) deny.push(`mcp__${normalizeMcpName(ref.id)}`);
  }
  const settings: Record<string, unknown> = {
    ...(deny.length > 0 ? { permissions: { deny } } : {}),
    ...(Object.keys(skillOverrides).length > 0 ? { skillOverrides } : {}),
    ...(Object.keys(enabledPlugins).length > 0 ? { enabledPlugins } : {}),
    ...(allConnectorsOff ? { disableClaudeAiConnectors: true } : {}),
  };
  return Object.keys(settings).length === 0 ? [] : ['--settings', JSON.stringify(settings)];
}

export const claudeCapabilities: CapabilityAdapter = {
  list,
  launchArgs,
  setEnabled: () => Promise.reject(new Error('Claude usa só o modo launch.')),
};
