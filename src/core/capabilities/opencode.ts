import { join } from 'node:path';
import { readIfExists, serialize, updateJsonFile } from './file-edit.js';
import { baseItem, categoryFromFsError, isRecord, pluginNamesIn, skillsIn } from './shared.js';
import type {
  CapabilityAdapter,
  CapabilityCategoryResult,
  CapabilityContext,
  CapabilityItem,
  CapabilityListing,
  SetEnabledInput,
} from './types.js';

const NO_HOME_MESSAGE = 'HOME não definido.';
const INVALID_CONFIG_MESSAGE = 'O opencode.json do OpenCode é inválido.';
const UNSUPPORTED_KIND_MESSAGE = 'OpenCode não suporta desligar este item.';
const PLUGIN_LIST_FAILED_MESSAGE = 'Não foi possível listar os plugins do OpenCode';
const SKILL_LIST_FAILED_MESSAGE = 'Não foi possível listar as skills do OpenCode';
const CATEGORY_KINDS = ['skill', 'mcp', 'plugin'] as const;

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

function mcpServers(config: Config): Config {
  const mcp = config['mcp'];
  if (!isRecord(mcp)) return {};
  const nested = mcp['servers'];
  return isRecord(nested) ? nested : mcp;
}

function mcpItems(config: Config): CapabilityItem[] {
  return Object.entries(mcpServers(config))
    .filter(([, server]) => isRecord(server))
    .map(([id, server]) =>
      globalItem(
        baseItem({ kind: 'mcp', id, enabled: !(isRecord(server) && server['disabled'] === true) }),
      ),
    );
}

function pluginEntries(config: Config): string[] {
  const entries: unknown = config['plugins'];
  return Array.isArray(entries)
    ? entries.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

async function pluginCategory(input: {
  dir: string;
  config: Config;
}): Promise<CapabilityCategoryResult> {
  try {
    const entries = pluginEntries(input.config);
    const off = new Set(entries.filter((e) => e.startsWith('-')).map((e) => e.slice(1)));
    const listed = entries.filter((entry) => !entry.startsWith('-'));
    const folder = await pluginNamesIn(join(input.dir, 'plugins'));
    const ids = [...new Set([...listed, ...folder, ...off])].sort();
    const items = ids.map((id) =>
      globalItem(baseItem({ kind: 'plugin', id, enabled: !off.has(id) })),
    );
    return { kind: 'plugin', items, error: null };
  } catch (error: unknown) {
    return categoryFromFsError({ kind: 'plugin', message: PLUGIN_LIST_FAILED_MESSAGE, error });
  }
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const dir = openCodeDir(ctx);
  const failed = (error: string): CapabilityListing => ({
    categories: CATEGORY_KINDS.map((kind) => ({ kind, items: [], error })),
    cost: null,
  });
  if (dir === null) return failed(NO_HOME_MESSAGE);
  const config = await readConfig(dir);
  if (config === null) return failed(INVALID_CONFIG_MESSAGE);
  const mcp: CapabilityCategoryResult = { kind: 'mcp', items: mcpItems(config), error: null };
  const [skill, plugin] = await Promise.all([
    skillCategory({ dir, config }),
    pluginCategory({ dir, config }),
  ]);
  return { categories: [skill, mcp, plugin], cost: null };
}

function isSkillDeny(rule: unknown, id: string): boolean {
  return (
    isRecord(rule) &&
    rule['action'] === 'skill' &&
    rule['resource'] === id &&
    rule['effect'] === 'deny'
  );
}

function permissionRules(config: Config): unknown[] {
  const rules: unknown = config['permissions'];
  return Array.isArray(rules) ? rules : [];
}

async function skillCategory(input: {
  dir: string;
  config: Config;
}): Promise<CapabilityCategoryResult> {
  try {
    const rules = permissionRules(input.config);
    const skills = await skillsIn(join(input.dir, 'skills'));
    const items = skills.map((skill) =>
      globalItem(
        baseItem({
          kind: 'skill',
          id: skill.id,
          enabled: !rules.some((rule) => isSkillDeny(rule, skill.id)),
          description: skill.description,
        }),
      ),
    );
    return { kind: 'skill', items, error: null };
  } catch (error: unknown) {
    return categoryFromFsError({ kind: 'skill', message: SKILL_LIST_FAILED_MESSAGE, error });
  }
}

function withSkillDisabled(input: { root: Config; id: string; enabled: boolean }): Config {
  const rest = permissionRules(input.root).filter((rule) => !isSkillDeny(rule, input.id));
  const deny = { action: 'skill', resource: input.id, effect: 'deny' };
  return { ...input.root, permissions: input.enabled ? rest : [...rest, deny] };
}

function withPluginDisabled(input: { root: Config; id: string; enabled: boolean }): Config {
  const marker = `-${input.id}`;
  const current: unknown = input.root['plugins'];
  const entries: unknown[] = Array.isArray(current) ? current : [];
  const rest = entries.filter((entry) => entry !== marker);
  return { ...input.root, plugins: input.enabled ? rest : [...rest, marker] };
}

function withMcpDisabled(input: { root: Config; id: string; enabled: boolean }): Config {
  const servers = mcpServers(input.root);
  const current = servers[input.id];
  if (!isRecord(current)) throw new Error(`Item não encontrado: ${input.id}.`);
  const { disabled: _previous, ...rest } = current;
  const server = input.enabled ? rest : { ...rest, disabled: true };
  const updated = { ...servers, [input.id]: server };
  const mcp = input.root['mcp'];
  const mcpUpdated =
    isRecord(mcp) && isRecord(mcp['servers']) ? { ...mcp, servers: updated } : updated;
  return { ...input.root, mcp: mcpUpdated };
}

function configUpdateFor(input: SetEnabledInput): ((root: Config) => Config) | null {
  const { ref, enabled } = input;
  if (ref.kind === 'mcp') return (root) => withMcpDisabled({ root, id: ref.id, enabled });
  if (ref.kind === 'plugin') return (root) => withPluginDisabled({ root, id: ref.id, enabled });
  if (ref.kind === 'skill') return (root) => withSkillDisabled({ root, id: ref.id, enabled });
  return null;
}

function setEnabled(input: SetEnabledInput): Promise<void> {
  const dir = openCodeDir(input.ctx);
  if (dir === null) return Promise.reject(new Error(NO_HOME_MESSAGE));
  const update = configUpdateFor(input);
  if (update === null) return Promise.reject(new Error(UNSUPPORTED_KIND_MESSAGE));
  const file = join(dir, 'opencode.json');
  return serialize(file, () => updateJsonFile({ file, backupRoot: input.ctx.backupRoot, update }));
}

export const opencodeCapabilities: CapabilityAdapter = {
  list,
  launchArgs: () => [],
  setEnabled,
};
