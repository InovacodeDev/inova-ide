import { join } from 'node:path';
import { readIfExists, serialize, updateJsonFile } from './file-edit.js';
import { baseItem, categoryFromFsError, isRecord, parseJson, skillsIn } from './shared.js';
import type {
  CapabilityAdapter,
  CapabilityCategoryResult,
  CapabilityContext,
  CapabilityItem,
  CapabilityListing,
  SetEnabledInput,
} from './types.js';

const SKILL_REASON = 'Kimi não permite desligar skills uma a uma.';
const PLUGIN_REASON = 'Kimi só desliga plugins dentro da sessão (/plugins disable).';
const UNSUPPORTED_KIND_MESSAGE = 'Kimi não suporta desligar este item.';
const INVALID_MCP_MESSAGE = 'O mcp.json do Kimi é inválido.';
const INVALID_PLUGINS_MESSAGE = 'O installed.json do Kimi é inválido.';
const SKILL_LIST_FAILED_MESSAGE = 'Não foi possível listar as skills do Kimi';

function mcpFile(ctx: CapabilityContext): string {
  return join(ctx.account.homeDir, 'mcp.json');
}

function unsupported(item: CapabilityItem, reason: string): CapabilityItem {
  return { ...item, applyMode: 'unsupported', unsupportedReason: reason };
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

async function skillCategory(ctx: CapabilityContext): Promise<CapabilityCategoryResult> {
  try {
    const skills = await skillsIn(join(ctx.account.homeDir, 'skills'));
    const items = skills.map((skill) =>
      unsupported(
        baseItem({ kind: 'skill', id: skill.id, enabled: true, description: skill.description }),
        SKILL_REASON,
      ),
    );
    return { kind: 'skill', items, error: null };
  } catch (error: unknown) {
    return categoryFromFsError({ kind: 'skill', message: SKILL_LIST_FAILED_MESSAGE, error });
  }
}

function pluginName(entry: unknown): string[] {
  if (typeof entry === 'string') return [entry];
  return isRecord(entry) && typeof entry['name'] === 'string' ? [entry['name']] : [];
}

async function pluginCategory(ctx: CapabilityContext): Promise<CapabilityCategoryResult> {
  const raw = await readIfExists(join(ctx.account.homeDir, 'plugins', 'installed.json'));
  if (raw === null) return { kind: 'plugin', items: [], error: null };
  const parsed = parseJson(raw);
  let names: string[] = [];
  if (Array.isArray(parsed)) names = parsed.flatMap(pluginName);
  else if (isRecord(parsed)) names = Object.keys(parsed);
  else return { kind: 'plugin', items: [], error: INVALID_PLUGINS_MESSAGE };
  const items = [...new Set(names)].map((id) =>
    unsupported(baseItem({ kind: 'plugin', id, enabled: true }), PLUGIN_REASON),
  );
  return { kind: 'plugin', items, error: null };
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const categories = await Promise.all([skillCategory(ctx), mcpCategory(ctx), pluginCategory(ctx)]);
  return { categories, cost: null };
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
        if (!isRecord(current)) throw new Error(`Item não encontrado: ${ref.id}.`);
        const { enabled: _previous, ...rest } = current;
        const server = enabled ? rest : { ...rest, enabled: false };
        return { ...root, mcpServers: { ...servers, [ref.id]: server } };
      },
    }),
  );
}

export const kimiCapabilities: CapabilityAdapter = { list, launchArgs: () => [], setEnabled };
