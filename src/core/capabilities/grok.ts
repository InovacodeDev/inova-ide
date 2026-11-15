import { join } from 'node:path';
import {
  readIfExists,
  serialize,
  setTomlArrayMembership,
  setTomlTableKey,
  tomlTableHeader,
  updateTomlFile,
} from './file-edit.js';
import { baseItem, isRecord, pluginNamesIn, skillsIn } from './shared.js';
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
// REGEX: double-quoted TOML basic string
const QUOTED_STRING = /"(?:[^"\\]|\\.)*"/g;

// REGEX: single-bracket table header with optional trailing comment
const TABLE_HEADER = /^\s*\[\s*([^[\]]+?)\s*\]\s*(?:#.*)?$/;
// REGEX: bare or double-quoted dotted-key segment
const KEY_SEGMENT = /"(?:[^"\\]|\\.)*"|[^.\s"]+/g;

function configFile(ctx: CapabilityContext): string {
  return join(ctx.account.homeDir, 'config.toml');
}

function tableSegments(path: string): string[] {
  return [...path.matchAll(KEY_SEGMENT)].map((match) =>
    match[0].startsWith('"') ? (JSON.parse(match[0]) as string) : match[0],
  );
}

function isMalformed(lines: readonly string[]): boolean {
  return lines.some((line) => {
    const text = line.trimStart();
    return text.startsWith('[') && !text.startsWith('[[') && !TABLE_HEADER.test(line);
  });
}

function mcpServers(toml: string): Map<string, boolean> | null {
  const lines = toml.split('\n');
  if (isMalformed(lines)) return null;
  const servers = new Map<string, boolean>();
  let current: string | null = null;
  for (const line of lines) {
    const header = TABLE_HEADER.exec(line);
    if (header) {
      const [root, name, ...rest] = tableSegments(header[1] ?? '');
      current = root === 'mcp_servers' && name !== undefined && rest.length === 0 ? name : null;
      if (current !== null && !servers.has(current)) servers.set(current, true);
    } else if (current !== null && /^\s*enabled\s*=\s*false\b/.test(line)) {
      servers.set(current, false);
    }
  }
  return servers;
}

function mcpCategory(toml: string): CapabilityCategoryResult {
  const servers = mcpServers(toml);
  if (servers === null) return { kind: 'mcp', items: [], error: INVALID_CONFIG_MESSAGE };
  const items = [...servers].map(([id, enabled]) => baseItem({ kind: 'mcp', id, enabled }));
  return { kind: 'mcp', items, error: null };
}

function disabledMembers(toml: string, table: string): Set<string> {
  const members = new Set<string>();
  let inTable = false;
  let collecting = false;
  for (const line of toml.split('\n')) {
    const header = TABLE_HEADER.exec(line);
    if (header) inTable = (header[1] ?? '').trim() === table;
    const start = /^\s*disabled\s*=\s*\[(.*)$/.exec(line);
    if (inTable && start) collecting = true;
    if (!collecting) continue;
    const text = start ? (start[1] ?? '') : line;
    for (const quoted of text.split(']')[0]?.match(QUOTED_STRING) ?? []) {
      members.add(JSON.parse(quoted) as string);
    }
    if (text.includes(']')) collecting = false;
  }
  return members;
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
    const code = isRecord(error) ? error['code'] : undefined;
    if (typeof code !== 'string') throw error;
    return { kind: input.kind, items: [], error: `${LIST_FAILED_MESSAGE[input.kind]} (${code}).` };
  }
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const toml = (await readIfExists(configFile(ctx))) ?? '';
  if (isMalformed(toml.split('\n'))) {
    const kinds = ['skill', 'mcp', 'plugin'] as const;
    const categories = kinds.map((kind) => ({ kind, items: [], error: INVALID_CONFIG_MESSAGE }));
    return { categories, cost: null };
  }
  const pluginNames = async () =>
    (await pluginNamesIn(join(ctx.account.homeDir, 'plugins'))).map((id) => ({
      id,
      description: null,
    }));
  const categories = await Promise.all([
    folderCategory({
      kind: 'skill',
      names: () => skillsIn(join(ctx.account.homeDir, 'skills')),
      disabled: disabledMembers(toml, 'skills'),
    }),
    mcpCategory(toml),
    folderCategory({
      kind: 'plugin',
      names: pluginNames,
      disabled: disabledMembers(toml, 'plugins'),
    }),
  ]);
  return { categories, cost: null };
}

function tomlUpdateFor(input: SetEnabledInput): ((toml: string) => string) | null {
  const { ref, enabled } = input;
  if (ref.kind === 'mcp') {
    const table = tomlTableHeader(['mcp_servers', ref.id]);
    return (toml) => setTomlTableKey({ toml, table, key: 'enabled', value: enabled });
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
