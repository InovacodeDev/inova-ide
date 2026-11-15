import { join } from 'node:path';
import {
  readIfExists,
  serialize,
  setTomlArrayMembership,
  setTomlTableKey,
  tomlTableHeader,
  updateTomlFile,
} from './file-edit.js';
import { baseItem } from './shared.js';
import type {
  CapabilityAdapter,
  CapabilityCategoryResult,
  CapabilityContext,
  CapabilityListing,
  SetEnabledInput,
} from './types.js';

const UNSUPPORTED_KIND_MESSAGE = 'Grok não suporta desligar este item.';
const INVALID_CONFIG_MESSAGE = 'O config.toml do Grok é inválido.';

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

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const toml = (await readIfExists(configFile(ctx))) ?? '';
  return { categories: [mcpCategory(toml)], cost: null };
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
