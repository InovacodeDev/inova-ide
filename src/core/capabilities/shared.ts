import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isMissingFile, readIfExists } from './file-edit.js';
import type { CapabilityItem } from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function baseItem(
  input: Pick<CapabilityItem, 'kind' | 'id' | 'enabled'> & { description?: string | null },
): CapabilityItem {
  return {
    kind: input.kind,
    id: input.id,
    enabled: input.enabled,
    name: input.id,
    description: input.description ?? null,
    source: 'user',
    applyMode: 'account-file',
    unsupportedReason: null,
    tokens: null,
    group: null,
  };
}

export async function pluginNamesIn(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissingFile(error)) return [];
    throw error;
  }
  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => entry.name.replace(/\.(?:[cm]?js|ts)$/, ''));
}

function skillDescription(markdown: string): string | null {
  const lines = markdown.split('\n').map((line) => line.trimEnd());
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  const front = end === -1 ? lines.slice(1) : lines.slice(1, end);
  for (const line of front) {
    const value = /^description:\s*(.*)$/
      .exec(line)?.[1]
      ?.trim()
      .replace(/^(["'])(.*)\1$/, '$2');
    if (value === undefined) continue;
    // REGEX: YAML block scalar indicator (">" or "|" with optional chomping/indent marks)
    return value === '' || /^[>|][+-]?\d*$/.test(value) ? null : value;
  }
  return null;
}

export async function skillsIn(dir: string): Promise<{ id: string; description: string | null }[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissingFile(error)) return [];
    throw error;
  }
  const found = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(async (entry) => {
        const markdown = await readIfExists(join(dir, entry.name, 'SKILL.md'));
        return markdown === null
          ? null
          : { id: entry.name, description: skillDescription(markdown) };
      }),
  );
  return found.flatMap((skill) => (skill === null ? [] : [skill]));
}
