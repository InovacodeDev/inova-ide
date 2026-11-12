import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
  return env['INOVA_HOME'] ?? join(homedir(), '.inova');
}

function isStore(value: unknown): value is Store {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['version'] === 1 &&
    Array.isArray(candidate['accounts']) &&
    Array.isArray(candidate['projects'])
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
