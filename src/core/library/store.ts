import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { isMissingFile, serialize, writeAtomic } from '../capabilities/file-edit.js';
import type { Library, LibraryItem } from './types.js';
import { validateLibraryItem } from './validate.js';

export class LibraryCorruptError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`Library file is corrupt (${reason}): ${path}`);
    this.name = 'LibraryCorruptError';
    this.path = path;
  }
}

export class LibraryValidationError extends Error {
  constructor(reason: string) {
    super(`Invalid library item: ${reason}`);
    this.name = 'LibraryValidationError';
  }
}

export class LibraryItemNotFoundError extends Error {
  readonly id: string;

  constructor(id: string) {
    super(`Library item not found: ${id}`);
    this.name = 'LibraryItemNotFoundError';
    this.id = id;
  }
}

export function libraryDir(root: string): string {
  return join(root, 'library');
}

export function libraryFile(root: string): string {
  return join(libraryDir(root), 'library.json');
}

export function skillDir(root: string, id: string): string {
  const skillsRoot = resolve(libraryDir(root), 'skills');
  const target = resolve(skillsRoot, id);
  if (!target.startsWith(skillsRoot + sep)) {
    throw new LibraryValidationError('skill id escapes the skills directory');
  }
  return target;
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLibrary(file: string, parsed: unknown): Library {
  if (!isRecord(parsed) || parsed['version'] !== 1 || !Array.isArray(parsed['items'])) {
    throw new LibraryCorruptError(file, 'invalid shape');
  }
  const seen = new Set<string>();
  const items: LibraryItem[] = [];
  for (const raw of parsed['items'] as unknown[]) {
    const checked = validateLibraryItem(raw);
    if (!checked.ok) throw new LibraryCorruptError(file, `invalid item: ${checked.error}`);
    if (seen.has(checked.item.id)) {
      throw new LibraryCorruptError(file, `duplicate id: ${checked.item.id}`);
    }
    seen.add(checked.item.id);
    items.push(checked.item);
  }
  return { version: 1, items };
}

export async function loadLibrary(root: string): Promise<Library> {
  const file = libraryFile(root);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error: unknown) {
    if (isMissingFile(error)) return { version: 1, items: [] };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LibraryCorruptError(file, 'invalid JSON');
  }
  return parseLibrary(file, parsed);
}

async function createBackupDir(input: { root: string; at: Date }): Promise<string> {
  const parent = join(input.root, 'backups', 'library');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stamp = input.at.toISOString().replace(/[:.]/g, '-');
  for (let attempt = 0; ; attempt += 1) {
    const dir = join(parent, attempt === 0 ? stamp : `${stamp}-${attempt}`);
    try {
      await mkdir(dir, { mode: 0o700 });
      return dir;
    } catch (error: unknown) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
}

async function backupLibraryFile(input: { root: string; at: Date }): Promise<void> {
  const file = libraryFile(input.root);
  try {
    await stat(file);
  } catch (error: unknown) {
    if (isMissingFile(error)) return;
    throw error;
  }
  await copyFile(file, join(await createBackupDir(input), 'library.json'));
}

interface Mutation<T> {
  next: Library | null;
  result: T;
}

function mutateLibrary<T>(input: {
  root: string;
  at: Date;
  update: (library: Library) => Mutation<T>;
}): Promise<T> {
  const { root, at, update } = input;
  const file = libraryFile(root);
  return serialize(resolve(file), async () => {
    const { next, result } = update(await loadLibrary(root));
    if (next === null) return result;
    await backupLibraryFile({ root, at });
    await mkdir(libraryDir(root), { recursive: true, mode: 0o700 });
    await writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
    return result;
  });
}

function upsertItem(items: readonly LibraryItem[], item: LibraryItem): LibraryItem[] {
  const exists = items.some((current) => current.id === item.id);
  if (!exists) return [...items, item];
  return items.map((current) => (current.id === item.id ? item : current));
}

export async function saveLibraryItem(input: {
  root: string;
  item: LibraryItem;
  now?: () => Date;
}): Promise<LibraryItem> {
  const at = (input.now ?? (() => new Date()))();
  const checked = validateLibraryItem({ ...input.item, updatedAt: at.toISOString() });
  if (!checked.ok) throw new LibraryValidationError(checked.error);
  const { item } = checked;
  await mutateLibrary({
    root: input.root,
    at,
    update: (library) => ({
      next: { version: 1, items: upsertItem(library.items, item) },
      result: undefined,
    }),
  });
  return item;
}

export async function removeLibraryItem(input: {
  root: string;
  id: string;
  now?: () => Date;
}): Promise<{ removed: boolean }> {
  const at = (input.now ?? (() => new Date()))();
  const removedItem = await mutateLibrary({
    root: input.root,
    at,
    update: (library) => {
      const found = library.items.find((current) => current.id === input.id);
      if (!found) return { next: null, result: null };
      const items = library.items.filter((current) => current.id !== input.id);
      return { next: { version: 1, items }, result: found };
    },
  });
  if (!removedItem) return { removed: false };
  if (removedItem.kind === 'skill') {
    await rm(skillDir(input.root, removedItem.id), { recursive: true, force: true });
  }
  return { removed: true };
}

export async function setLibraryItemEnabled(input: {
  root: string;
  id: string;
  enabled: boolean;
  now?: () => Date;
}): Promise<LibraryItem> {
  const at = (input.now ?? (() => new Date()))();
  return mutateLibrary({
    root: input.root,
    at,
    update: (library) => {
      const found = library.items.find((current) => current.id === input.id);
      if (!found) throw new LibraryItemNotFoundError(input.id);
      const updated: LibraryItem = {
        ...found,
        enabled: input.enabled,
        updatedAt: at.toISOString(),
      };
      return { next: { version: 1, items: upsertItem(library.items, updated) }, result: updated };
    },
  });
}
