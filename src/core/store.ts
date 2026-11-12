import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { isProviderId } from './providers.js';
import type { Store } from './types.js';

export class StoreCorruptError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`Store file is corrupt (${reason}): ${path}`);
    this.name = 'StoreCorruptError';
    this.path = path;
  }
}

export function dataRoot(env: NodeJS.ProcessEnv): string {
  const configured = env['INOVA_HOME'];
  return configured ? resolve(configured) : join(homedir(), '.inova');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasStrings(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof record[key] === 'string');
}

function isSafeSegment(id: string): boolean {
  return id !== '' && id !== '.' && id !== '..' && !id.includes('/') && !id.includes('\\');
}

function isAccount(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasStrings(value, ['id', 'provider', 'label', 'homeDir', 'createdAt'])) return false;
  const { id, provider } = value;
  return (
    typeof id === 'string' &&
    typeof provider === 'string' &&
    isProviderId(provider) &&
    isSafeSegment(id)
  );
}

function isProject(value: unknown): boolean {
  return isRecord(value) && hasStrings(value, ['id', 'path', 'accountId']);
}

function isStore(value: unknown): value is Store {
  if (!isRecord(value)) return false;
  const { version, accounts, projects } = value;
  return (
    version === 1 &&
    Array.isArray(accounts) &&
    accounts.every(isAccount) &&
    Array.isArray(projects) &&
    projects.every(isProject)
  );
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function loadStore(root: string): Promise<Store> {
  const file = join(root, 'store.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error: unknown) {
    if (isMissingFile(error)) return { version: 1, accounts: [], projects: [] };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StoreCorruptError(file, 'invalid JSON');
  }
  if (!isStore(parsed)) throw new StoreCorruptError(file, 'invalid shape');
  return parsed;
}

export async function saveStore(root: string, store: Store): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = join(root, 'store.json');
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`);
  await rename(tmp, file);
}
