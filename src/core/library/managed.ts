import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isMissingFile, serialize, writeAtomic } from '../capabilities/file-edit.js';
import { createBackupDir, LibraryCorruptError, libraryDir } from './store.js';

export interface ManagedRegistry {
  version: 1;
  mcp: Record<string, string[]>;
}

export function managedFile(root: string): string {
  return join(libraryDir(root), 'managed.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function parseManaged(file: string, parsed: unknown): ManagedRegistry {
  if (!isRecord(parsed) || parsed['version'] !== 1 || !isRecord(parsed['mcp'])) {
    throw new LibraryCorruptError(file, 'invalid shape');
  }
  const mcp: Record<string, string[]> = {};
  for (const [accountId, names] of Object.entries(parsed['mcp'])) {
    if (accountId === '__proto__' || !isStringArray(names)) {
      throw new LibraryCorruptError(file, `invalid entry: ${accountId}`);
    }
    mcp[accountId] = names;
  }
  return { version: 1, mcp };
}

export async function loadManaged(root: string): Promise<ManagedRegistry> {
  const file = managedFile(root);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error: unknown) {
    if (isMissingFile(error)) return { version: 1, mcp: {} };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LibraryCorruptError(file, 'invalid JSON');
  }
  return parseManaged(file, parsed);
}

export function managedNamesFor(registry: ManagedRegistry, accountId: string): string[] {
  return Object.hasOwn(registry.mcp, accountId) ? (registry.mcp[accountId] ?? []) : [];
}

async function backupManagedFile(input: { root: string; at: Date }): Promise<void> {
  const file = managedFile(input.root);
  try {
    await stat(file);
  } catch (error: unknown) {
    if (isMissingFile(error)) return;
    throw error;
  }
  await copyFile(file, join(await createBackupDir(input), 'managed.json'));
}

export function saveManaged(input: {
  root: string;
  accountId: string;
  names: readonly string[];
  now?: () => Date;
}): Promise<void> {
  const { root, accountId } = input;
  const at = (input.now ?? (() => new Date()))();
  const file = managedFile(root);
  const names = [...new Set(input.names)].sort();
  return serialize(resolve(file), async () => {
    const current = await loadManaged(root);
    if (managedNamesFor(current, accountId).join('\n') === names.join('\n')) return;
    const next: ManagedRegistry = { version: 1, mcp: { ...current.mcp, [accountId]: names } };
    await backupManagedFile({ root, at });
    await mkdir(libraryDir(root), { recursive: true, mode: 0o700 });
    try {
      await writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
    } catch (error: unknown) {
      // NOTE: writeAtomic leaves "<file>.inova.tmp" behind when the final rename fails
      await rm(`${file}.inova.tmp`, { force: true });
      throw error;
    }
  });
}
