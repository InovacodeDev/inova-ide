import type { CommandRunner } from '../providers.js';
import { tomlTableHeader } from './file-edit.js';
import type {
  CapabilityAdapter,
  CapabilityContext,
  CapabilityItem,
  CapabilityListing,
  CapabilityRef,
} from './types.js';

const COMMAND_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDisabled(disabled: readonly CapabilityRef[], ref: CapabilityRef): boolean {
  return disabled.some((entry) => entry.kind === ref.kind && entry.id === ref.id);
}

function parseMcpItems(stdout: string, disabled: readonly CapabilityRef[]): CapabilityItem[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) return [];
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

function runCodex(ctx: CapabilityContext, args: string[]): ReturnType<CommandRunner['run']> {
  return ctx.runner.run({ command: 'codex', args, env: ctx.env, timeoutMs: COMMAND_TIMEOUT_MS });
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const mcp = await runCodex(ctx, ['mcp', 'list', '--json']);
  const items =
    'exitCode' in mcp ? parseMcpItems(mcp.stdout, ctx.account.disabledCapabilities ?? []) : [];
  return { categories: [{ kind: 'mcp', items, error: null }], cost: null };
}

function launchArgs(disabled: readonly CapabilityRef[]): string[] {
  return disabled
    .filter((ref) => ref.kind === 'mcp')
    .flatMap((ref) => ['-c', `${tomlTableHeader(['mcp_servers', ref.id])}.enabled=false`]);
}

export const codexCapabilities: CapabilityAdapter = {
  list,
  launchArgs,
  setEnabled: () => Promise.reject(new Error('MCP do Codex usa só o modo launch.')),
};
