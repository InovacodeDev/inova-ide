import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { isEffortLevel } from './models.js';
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

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isSession(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasStrings(value, ['id', 'projectId', 'title', 'createdAt', 'updatedAt'])) return false;
  const { id, parentId, providerSessionId, model, effort, archivedAt } = value;
  return (
    typeof id === 'string' &&
    isSafeSegment(id) &&
    isStringOrNull(parentId) &&
    isStringOrNull(providerSessionId) &&
    (model === undefined || isStringOrNull(model)) &&
    (effort === undefined || effort === null || isEffortLevel(effort)) &&
    (archivedAt === undefined || isStringOrNull(archivedAt))
  );
}

function isSafeIdOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'string' && isSafeSegment(value));
}

function isWorkspace(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { openSessionIds, activeSessionId } = value;
  return (
    Array.isArray(openSessionIds) &&
    openSessionIds.every((id) => typeof id === 'string' && isSafeSegment(id)) &&
    isSafeIdOrNull(activeSessionId)
  );
}

function isStore(value: unknown): value is Store {
  if (!isRecord(value)) return false;
  const { version, accounts, projects, sessions, workspace } = value;
  return (
    version === 1 &&
    Array.isArray(accounts) &&
    accounts.every(isAccount) &&
    Array.isArray(projects) &&
    projects.every(isProject) &&
    (sessions === undefined || (Array.isArray(sessions) && sessions.every(isSession))) &&
    (workspace === undefined || isWorkspace(workspace))
  );
}

function normalizeSessions(store: Store): Store {
  if (!store.sessions) return store;
  return {
    ...store,
    sessions: store.sessions.map((session) => ({
      ...session,
      archivedAt: session.archivedAt ?? null,
    })),
  };
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
  return normalizeSessions(parsed);
}

export async function saveStore(root: string, store: Store): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = join(root, 'store.json');
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`);
    await rename(tmp, file);
  } catch (error: unknown) {
    await rm(tmp, { force: true });
    throw error;
  }
}
