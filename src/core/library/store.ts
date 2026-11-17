import { copyFile, cp, lstat, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { isMissingFile, serialize, writeAtomic } from '../capabilities/file-edit.js';
import type { Library, LibraryItem, LoadedLibrary } from './types.js';
import { isLibraryId, validateLibraryItem } from './validate.js';

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

interface QuarantinedItem {
  id: string;
  error: string;
  raw: unknown;
}

interface LibraryState {
  library: Library;
  quarantined: QuarantinedItem[];
}

interface NextState {
  items: LibraryItem[];
  quarantined: QuarantinedItem[];
}

function parseLibrary(file: string, parsed: unknown): LibraryState {
  if (!isRecord(parsed) || parsed['version'] !== 1 || !Array.isArray(parsed['items'])) {
    throw new LibraryCorruptError(file, 'invalid shape');
  }
  const seen = new Set<string>();
  const items: LibraryItem[] = [];
  const quarantined: QuarantinedItem[] = [];
  for (const raw of parsed['items'] as unknown[]) {
    const id = isRecord(raw) ? raw['id'] : undefined;
    if (typeof id !== 'string') throw new LibraryCorruptError(file, 'item without a string id');
    if (seen.has(id)) throw new LibraryCorruptError(file, `duplicate id: ${id}`);
    seen.add(id);
    const checked = validateLibraryItem(raw);
    if (checked.ok) items.push(checked.item);
    else quarantined.push({ id, error: checked.error, raw });
  }
  return { library: { version: 1, items }, quarantined };
}

async function readLibraryState(root: string): Promise<LibraryState> {
  const file = libraryFile(root);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error: unknown) {
    if (isMissingFile(error)) return { library: { version: 1, items: [] }, quarantined: [] };
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

export async function loadLibraryWithInvalid(root: string): Promise<LoadedLibrary> {
  const { library, quarantined } = await readLibraryState(root);
  return { library, invalid: quarantined.map(({ id, error }) => ({ id, error })) };
}

export async function loadLibrary(root: string): Promise<Library> {
  return (await readLibraryState(root)).library;
}

export async function createBackupDir(input: { root: string; at: Date }): Promise<string> {
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

type BackupDirProvider = () => Promise<string>;

function lazyBackupDir(input: { root: string; at: Date }): BackupDirProvider {
  let pending: Promise<string> | undefined;
  return () => (pending ??= createBackupDir(input));
}

async function backupLibraryFile(input: {
  root: string;
  backupDir: BackupDirProvider;
}): Promise<void> {
  const file = libraryFile(input.root);
  try {
    await stat(file);
  } catch (error: unknown) {
    if (isMissingFile(error)) return;
    throw error;
  }
  await copyFile(file, join(await input.backupDir(), 'library.json'));
}

async function backupSkillDir(input: {
  root: string;
  id: string;
  backupDir: BackupDirProvider;
}): Promise<void> {
  const source = skillDir(input.root, input.id);
  try {
    await lstat(source);
  } catch (error: unknown) {
    if (isMissingFile(error)) return;
    throw error;
  }
  const dest = join(await input.backupDir(), 'skills', input.id);
  await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
  await cp(source, dest, { recursive: true, verbatimSymlinks: true });
}

interface Mutation<T> {
  next: NextState | null;
  result: T;
}

function mutateLibrary<T>(input: {
  root: string;
  at: Date;
  update: (state: LibraryState) => Mutation<T>;
  beforeWrite?: (context: { result: T; backupDir: BackupDirProvider }) => Promise<void>;
}): Promise<T> {
  const { root, at, update, beforeWrite } = input;
  const file = libraryFile(root);
  return serialize(resolve(file), async () => {
    const { next, result } = update(await readLibraryState(root));
    if (next === null) return result;
    const backupDir = lazyBackupDir({ root, at });
    await beforeWrite?.({ result, backupDir });
    await backupLibraryFile({ root, backupDir });
    await mkdir(libraryDir(root), { recursive: true, mode: 0o700 });
    try {
      await writeAtomic(file, serializeLibrary(next));
    } catch (error: unknown) {
      // NOTE: writeAtomic leaves "<file>.inova.tmp" behind when the final rename fails
      await rm(`${file}.inova.tmp`, { force: true });
      throw error;
    }
    return result;
  });
}

function serializeLibrary(next: NextState): string {
  const items = [...next.items, ...next.quarantined.map((entry) => entry.raw)];
  return `${JSON.stringify({ version: 1, items }, null, 2)}\n`;
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
    update: ({ library, quarantined }) => ({
      next: {
        items: upsertItem(library.items, item),
        quarantined: quarantined.filter((entry) => entry.id !== item.id),
      },
      result: undefined,
    }),
  });
  return item;
}

function skillIdToRemove(input: { id: string; kind: unknown }): string | null {
  return input.kind === 'skill' && isLibraryId(input.id) ? input.id : null;
}

export async function removeLibraryItem(input: {
  root: string;
  id: string;
  now?: () => Date;
}): Promise<{ removed: boolean }> {
  const at = (input.now ?? (() => new Date()))();
  const removal = await mutateLibrary({
    root: input.root,
    at,
    update: ({ library, quarantined }) => {
      const found = library.items.find((current) => current.id === input.id);
      const stale = quarantined.find((entry) => entry.id === input.id);
      if (!found && !stale) return { next: null, result: null };
      const rawKind = stale && isRecord(stale.raw) ? stale.raw['kind'] : undefined;
      return {
        next: {
          items: library.items.filter((current) => current.id !== input.id),
          quarantined: quarantined.filter((entry) => entry.id !== input.id),
        },
        result: { skillId: skillIdToRemove({ id: input.id, kind: found?.kind ?? rawKind }) },
      };
    },
    beforeWrite: async ({ result, backupDir }) => {
      if (result?.skillId)
        await backupSkillDir({ root: input.root, id: result.skillId, backupDir });
    },
  });
  if (!removal) return { removed: false };
  if (removal.skillId) {
    await rm(skillDir(input.root, removal.skillId), { recursive: true, force: true });
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
    update: ({ library, quarantined }) => {
      const found = library.items.find((current) => current.id === input.id);
      if (!found) throw new LibraryItemNotFoundError(input.id);
      const updated: LibraryItem = {
        ...found,
        enabled: input.enabled,
        updatedAt: at.toISOString(),
      };
      return { next: { items: upsertItem(library.items, updated), quarantined }, result: updated };
    },
  });
}
