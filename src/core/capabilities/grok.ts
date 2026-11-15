import { join } from 'node:path';
import {
  CapabilityFileError,
  listTomlTables,
  readIfExists,
  readTomlArrayMembers,
  readTomlTableKey,
  serialize,
  setTomlArrayMembership,
  setTomlTableKey,
  tomlTableHeader,
  updateTomlFile,
} from './file-edit.js';
import { baseItem, categoryFromFsError, pluginNamesIn, skillsIn } from './shared.js';
import type {
  CapabilityAdapter,
  CapabilityCategoryResult,
  CapabilityContext,
  CapabilityListing,
  SetEnabledInput,
} from './types.js';

const UNSUPPORTED_KIND_MESSAGE = 'Grok não suporta desligar este item.';
const INVALID_CONFIG_MESSAGE = 'O config.toml do Grok é inválido.';
const LIST_FAILED_MESSAGE = {
  skill: 'Não foi possível listar as skills do Grok',
  plugin: 'Não foi possível listar os plugins do Grok',
};

interface GrokConfig {
  servers: { id: string; enabled: boolean }[];
  disabledSkills: Set<string>;
  disabledPlugins: Set<string>;
}

function configFile(ctx: CapabilityContext): string {
  return join(ctx.account.homeDir, 'config.toml');
}

function serverIds(toml: string): string[] {
  const names = listTomlTables(toml).flatMap(([root, name, ...rest]) =>
    root === 'mcp_servers' && name !== undefined && rest.length === 0 ? [name] : [],
  );
  return [...new Set(names)];
}

function parseConfig(toml: string): GrokConfig | null {
  try {
    const servers = serverIds(toml).map((id) => {
      const table = tomlTableHeader(['mcp_servers', id]);
      const value = readTomlTableKey({ toml, table, key: 'enabled' });
      return { id, enabled: !/^false\b/.test(value ?? '') };
    });
    const disabled = (table: string) =>
      new Set(readTomlArrayMembers({ toml, table, key: 'disabled' }));
    return { servers, disabledSkills: disabled('skills'), disabledPlugins: disabled('plugins') };
  } catch (error: unknown) {
    if (error instanceof CapabilityFileError) return null;
    throw error;
  }
}

async function folderCategory(input: {
  kind: 'skill' | 'plugin';
  names: () => Promise<{ id: string; description: string | null }[]>;
  disabled: Set<string>;
}): Promise<CapabilityCategoryResult> {
  try {
    const items = (await input.names()).map((entry) =>
      baseItem({ ...entry, kind: input.kind, enabled: !input.disabled.has(entry.id) }),
    );
    return { kind: input.kind, items, error: null };
  } catch (error: unknown) {
    return categoryFromFsError({
      kind: input.kind,
      message: LIST_FAILED_MESSAGE[input.kind],
      error,
    });
  }
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const config = parseConfig((await readIfExists(configFile(ctx))) ?? '');
  if (config === null) {
    const kinds = ['skill', 'mcp', 'plugin'] as const;
    const categories = kinds.map((kind) => ({ kind, items: [], error: INVALID_CONFIG_MESSAGE }));
    return { categories, cost: null };
  }
  const pluginNames = async () =>
    (await pluginNamesIn(join(ctx.account.homeDir, 'plugins'))).map((id) => ({
      id,
      description: null,
    }));
  const mcp: CapabilityCategoryResult = {
    kind: 'mcp',
    items: config.servers.map(({ id, enabled }) => baseItem({ kind: 'mcp', id, enabled })),
    error: null,
  };
  const [skill, plugin] = await Promise.all([
    folderCategory({
      kind: 'skill',
      names: () => skillsIn(join(ctx.account.homeDir, 'skills')),
      disabled: config.disabledSkills,
    }),
    folderCategory({ kind: 'plugin', names: pluginNames, disabled: config.disabledPlugins }),
  ]);
  return { categories: [skill, mcp, plugin], cost: null };
}

function tomlUpdateFor(input: SetEnabledInput): ((toml: string) => string) | null {
  const { ref, enabled } = input;
  if (ref.kind === 'mcp') {
    const table = tomlTableHeader(['mcp_servers', ref.id]);
    return (toml) => {
      if (!serverIds(toml).includes(ref.id)) throw new Error(`Item não encontrado: ${ref.id}.`);
      return setTomlTableKey({ toml, table, key: 'enabled', value: enabled });
    };
  }
  if (ref.kind !== 'skill' && ref.kind !== 'plugin') return null;
  const table = ref.kind === 'skill' ? 'skills' : 'plugins';
  return (toml) =>
    setTomlArrayMembership({ toml, table, key: 'disabled', member: ref.id, present: !enabled });
}

function setEnabled(input: SetEnabledInput): Promise<void> {
  const update = tomlUpdateFor(input);
  if (update === null) return Promise.reject(new Error(UNSUPPORTED_KIND_MESSAGE));
  const file = configFile(input.ctx);
  return serialize(file, () => updateTomlFile({ file, backupRoot: input.ctx.backupRoot, update }));
}

export const grokCapabilities: CapabilityAdapter = { list, launchArgs: () => [], setEnabled };
