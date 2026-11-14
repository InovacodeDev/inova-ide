import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isMissingFile, readIfExists, serialize, updateJsonFile } from './file-edit.js';
import { baseItem, isRecord, skillsIn } from './shared.js';
import type {
  CapabilityAdapter,
  CapabilityCategoryResult,
  CapabilityContext,
  CapabilityItem,
  CapabilityListing,
  SetEnabledInput,
} from './types.js';

const UNSUPPORTED_KIND_MESSAGE = 'Qwen não suporta desligar este item.';
const EXTENSION_UNSUPPORTED_REASON =
  'O Inova ainda não consegue ler o estado das extensões do Qwen. Use qwen extensions enable/disable.';
const INVALID_SETTINGS_MESSAGE = 'O settings.json do Qwen é inválido.';
const SKILL_LIST_FAILED_MESSAGE = 'Não foi possível listar as skills do Qwen';
const EXTENSION_LIST_FAILED_MESSAGE = 'Não foi possível listar as extensões do Qwen';

type Settings = Record<string, unknown>;

function settingsFile(ctx: CapabilityContext): string {
  return join(ctx.account.homeDir, '.qwen', 'settings.json');
}

async function readSettings(ctx: CapabilityContext): Promise<Settings | null> {
  const raw = await readIfExists(settingsFile(ctx));
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function stringList(parent: unknown, key: string): string[] {
  const list = isRecord(parent) ? parent[key] : undefined;
  return Array.isArray(list)
    ? list.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function mcpItems(settings: Settings): CapabilityItem[] {
  const excluded = stringList(settings['mcp'], 'excluded');
  const servers = isRecord(settings['mcpServers']) ? Object.keys(settings['mcpServers']) : [];
  return servers.map((id) => baseItem({ kind: 'mcp', id, enabled: !excluded.includes(id) }));
}

async function skillCategory(
  ctx: CapabilityContext,
  settings: Settings,
): Promise<CapabilityCategoryResult> {
  const disabled = stringList(settings['skills'], 'disabled');
  try {
    const skills = await skillsIn(join(ctx.account.homeDir, '.qwen', 'skills'));
    const items = skills.map((skill) =>
      baseItem({
        kind: 'skill',
        id: skill.id,
        enabled: !disabled.includes(skill.id),
        description: skill.description,
      }),
    );
    return { kind: 'skill', items, error: null };
  } catch (error: unknown) {
    const code = isRecord(error) ? error['code'] : undefined;
    if (typeof code !== 'string') throw error;
    return { kind: 'skill', items: [], error: `${SKILL_LIST_FAILED_MESSAGE} (${code}).` };
  }
}

function manifestName(raw: string): string | null {
  try {
    const manifest: unknown = JSON.parse(raw);
    return isRecord(manifest) && typeof manifest['name'] === 'string' ? manifest['name'] : null;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function extensionNames(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissingFile(error)) return [];
    throw error;
  }
  const names = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const raw = await readIfExists(join(dir, entry.name, 'qwen-extension.json'));
        return raw === null ? null : manifestName(raw);
      }),
  );
  return names.flatMap((name) => (name === null ? [] : [name]));
}

async function extensionCategory(ctx: CapabilityContext): Promise<CapabilityCategoryResult> {
  try {
    const names = await extensionNames(join(ctx.account.homeDir, '.qwen', 'extensions'));
    const items = names.map((id): CapabilityItem => ({
      ...baseItem({ kind: 'plugin', id, enabled: true }),
      applyMode: 'unsupported',
      unsupportedReason: EXTENSION_UNSUPPORTED_REASON,
    }));
    return { kind: 'plugin', items, error: null };
  } catch (error: unknown) {
    const code = isRecord(error) ? error['code'] : undefined;
    if (typeof code !== 'string') throw error;
    return { kind: 'plugin', items: [], error: `${EXTENSION_LIST_FAILED_MESSAGE} (${code}).` };
  }
}

async function list(ctx: CapabilityContext): Promise<CapabilityListing> {
  const [settings, extensions] = await Promise.all([readSettings(ctx), extensionCategory(ctx)]);
  if (settings === null) {
    const kinds = ['skill', 'mcp'] as const;
    return {
      categories: [
        ...kinds.map((kind) => ({ kind, items: [], error: INVALID_SETTINGS_MESSAGE })),
        extensions,
      ],
      cost: null,
    };
  }
  return {
    categories: [
      await skillCategory(ctx, settings),
      { kind: 'mcp', items: mcpItems(settings), error: null },
      extensions,
    ],
    cost: null,
  };
}

function withListMembership(input: {
  root: Settings;
  path: readonly [string, string];
  name: string;
  enabled: boolean;
}): Settings {
  const [group, key] = input.path;
  const parent = isRecord(input.root[group]) ? input.root[group] : {};
  const rest = stringList(parent, key).filter((entry) => entry !== input.name);
  const list = input.enabled ? rest : [...rest, input.name];
  return { ...input.root, [group]: { ...parent, [key]: list } };
}

function setEnabled(input: SetEnabledInput): Promise<void> {
  const { ctx, ref, enabled } = input;
  if (ref.kind === 'plugin') return Promise.reject(new Error(EXTENSION_UNSUPPORTED_REASON));
  if (ref.kind !== 'mcp' && ref.kind !== 'skill') {
    return Promise.reject(new Error(UNSUPPORTED_KIND_MESSAGE));
  }
  const path =
    ref.kind === 'skill' ? (['skills', 'disabled'] as const) : (['mcp', 'excluded'] as const);
  return serialize(`qwen:${ctx.account.id}`, () =>
    updateJsonFile({
      file: settingsFile(ctx),
      backupRoot: ctx.backupRoot,
      update: (root) => withListMembership({ root, path, name: ref.id, enabled }),
    }),
  );
}

export const qwenCapabilities: CapabilityAdapter = { list, launchArgs: () => [], setEnabled };
