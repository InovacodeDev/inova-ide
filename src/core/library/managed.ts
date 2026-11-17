import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isMissingFile, serialize, writeAtomic } from '../capabilities/file-edit.js';
import type { ProviderId } from '../types.js';
import { createBackupDir, LibraryCorruptError, libraryDir } from './store.js';

export type ManagedHashes = Record<string, string>;

export interface ManagedRegistry {
  version: 1;
  mcp: Record<string, string[]>;
  hashes: Record<string, ManagedHashes>;
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

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function parseTargets<T>(input: {
  file: string;
  value: unknown;
  isEntry: (entry: unknown) => entry is T;
}): Record<string, T> {
  const { file, value, isEntry } = input;
  const result: Record<string, T> = {};
  if (!isRecord(value)) return result;
  for (const [targetKey, entry] of Object.entries(value)) {
    if (targetKey === '__proto__' || !isEntry(entry)) {
      throw new LibraryCorruptError(file, 'invalid entry');
    }
    result[targetKey] = entry;
  }
  return result;
}

function parseManaged(file: string, parsed: unknown): ManagedRegistry {
  if (!isRecord(parsed) || parsed['version'] !== 1 || !isRecord(parsed['mcp'])) {
    throw new LibraryCorruptError(file, 'invalid shape');
  }
  if (parsed['hashes'] !== undefined && !isRecord(parsed['hashes'])) {
    throw new LibraryCorruptError(file, 'invalid shape');
  }
  return {
    version: 1,
    mcp: parseTargets({ file, value: parsed['mcp'], isEntry: isStringArray }),
    hashes: parseTargets({ file, value: parsed['hashes'], isEntry: isStringRecord }),
  };
}

export function emptyManaged(): ManagedRegistry {
  return { version: 1, mcp: {}, hashes: {} };
}

export function managedTargetKey(input: {
  provider: ProviderId;
  accountId: string;
  targetPath: string;
}): string {
  return input.provider === 'gemini' ? `agy:${input.accountId}` : resolve(input.targetPath);
}

export async function loadManaged(root: string): Promise<ManagedRegistry> {
  const file = managedFile(root);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error: unknown) {
    if (isMissingFile(error)) return emptyManaged();
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

export function managedNamesFor(registry: ManagedRegistry, targetKey: string): string[] {
  return Object.hasOwn(registry.mcp, targetKey) ? (registry.mcp[targetKey] ?? []) : [];
}

export function managedHashesFor(registry: ManagedRegistry, targetKey: string): ManagedHashes {
  return Object.hasOwn(registry.hashes, targetKey) ? (registry.hashes[targetKey] ?? {}) : {};
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

interface ManagedTargetState {
  names: readonly string[];
  hashes: Readonly<ManagedHashes>;
}

export function saveManaged(input: {
  root: string;
  targetKey: string;
  names: readonly string[];
  hashes?: Readonly<ManagedHashes>;
  now?: () => Date;
}): Promise<void> {
  const { names, hashes = {} } = input;
  return updateManaged({ ...input, next: () => ({ names, hashes }) });
}

export function changeManaged(input: {
  root: string;
  targetKey: string;
  add: Readonly<ManagedHashes>;
  drop: readonly string[];
  now?: () => Date;
}): Promise<void> {
  const { add, drop } = input;
  return updateManaged({
    ...input,
    next: (current) => {
      const kept = (name: string) => !drop.includes(name);
      const hashes = Object.entries(current.hashes).filter(([name]) => kept(name));
      return {
        names: [...current.names.filter(kept), ...Object.keys(add)],
        hashes: { ...Object.fromEntries(hashes), ...add },
      };
    },
  });
}

function sortedState(state: ManagedTargetState): { names: string[]; hashes: ManagedHashes } {
  const names = [...new Set(state.names)].sort();
  const hashes = names
    .filter((name) => Object.hasOwn(state.hashes, name))
    .map((name) => [name, state.hashes[name] ?? ''] as const);
  return { names, hashes: Object.fromEntries(hashes) };
}

function updateManaged(input: {
  root: string;
  targetKey: string;
  next: (current: ManagedTargetState) => ManagedTargetState;
  now?: () => Date;
}): Promise<void> {
  const { root, targetKey } = input;
  const at = (input.now ?? (() => new Date()))();
  const file = managedFile(root);
  return serialize(resolve(file), async () => {
    const current = await loadManaged(root);
    const previous = sortedState({
      names: managedNamesFor(current, targetKey),
      hashes: managedHashesFor(current, targetKey),
    });
    const state = sortedState(input.next(previous));
    if (JSON.stringify(previous) === JSON.stringify(state)) return;
    const next: ManagedRegistry = {
      version: 1,
      mcp: { ...current.mcp, [targetKey]: state.names },
      hashes: { ...current.hashes, [targetKey]: state.hashes },
    };
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
