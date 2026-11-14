import type { CommandRunner } from '../providers.js';
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
const MCP_TABLE_HEADER = /^NAME\s+TYPE\s+STATUS\b/;
const MCP_EMPTY_MESSAGE = 'No MCP servers configured.';

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

function runAgy(ctx: CapabilityContext, args: string[]): ReturnType<CommandRunner['run']> {
  return ctx.runner.run({ command: 'agy', args, env: ctx.env, timeoutMs: COMMAND_TIMEOUT_MS });
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const mcp = await runAgy(ctx, ['mcp', 'list']);
  if (!('exitCode' in mcp)) {
    return { categories: [{ kind: 'mcp', items: [], error: NOT_FOUND_MESSAGE }], cost: null };
  }
  const items = mcp.exitCode === 0 ? parseMcpItems(mcp.stdout) : null;
  return {
    categories: [
      items === null
        ? { kind: 'mcp', items: [], error: MCP_LIST_FAILED_MESSAGE }
        : { kind: 'mcp', items, error: null },
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
