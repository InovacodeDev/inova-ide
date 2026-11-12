import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { dataRoot, loadStore, saveStore, StoreCorruptError } from './store.js';
import type { Store } from './types.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inova-store-'));
});

describe('store', () => {
  it('loadStore returns empty store when file is missing', async () => {
    expect(await loadStore(root)).toEqual({ version: 1, accounts: [], projects: [] });
  });

  it('saveStore survives concurrent writers and leaves no temp files', async () => {
    const store: Store = { version: 1, accounts: [], projects: [] };
    await Promise.all(Array.from({ length: 20 }, () => saveStore(root, store)));
    expect(await loadStore(root)).toEqual(store);
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('saveStore removes its temp file when the final rename fails', async () => {
    await mkdir(join(root, 'store.json'));
    await expect(saveStore(root, { version: 1, accounts: [], projects: [] })).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('saveStore then loadStore round-trips', async () => {
    const store: Store = {
      version: 1,
      accounts: [
        { id: 'a1', provider: 'claude', label: 'work', homeDir: '/h', createdAt: '2026-01-01' },
      ],
      projects: [{ id: 'p1', path: '/repo', accountId: 'a1' }],
    };
    await saveStore(root, store);
    expect(await loadStore(root)).toEqual(store);
  });

  it('loadStore throws StoreCorruptError with file path on invalid JSON', async () => {
    const file = join(root, 'store.json');
    await writeFile(file, '{not json');
    const err = await loadStore(root).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StoreCorruptError);
    expect((err as StoreCorruptError).path).toBe(file);
    expect(await readFile(file, 'utf8')).toBe('{not json');
  });

  it('loadStore throws StoreCorruptError on invalid shape', async () => {
    await writeFile(join(root, 'store.json'), JSON.stringify({ version: 2, accounts: [] }));
    await expect(loadStore(root)).rejects.toBeInstanceOf(StoreCorruptError);
  });

  const goodAccount = {
    id: 'a1',
    provider: 'claude',
    label: 'work',
    homeDir: '/h',
    createdAt: '2026-01-01',
  };

  it.each([
    ['an empty id', { ...goodAccount, id: '' }],
    ['a dot id', { ...goodAccount, id: '.' }],
    ['a dotdot id', { ...goodAccount, id: '..' }],
    ['an id with a slash', { ...goodAccount, id: 'a/b' }],
    ['an id with a backslash', { ...goodAccount, id: 'a\\b' }],
    ['an unknown provider', { ...goodAccount, provider: 'other' }],
    ['a non-string label', { ...goodAccount, label: 1 }],
    ['a missing homeDir', { ...goodAccount, homeDir: undefined }],
  ])('loadStore rejects an account with %s', async (_name, account) => {
    await writeFile(
      join(root, 'store.json'),
      JSON.stringify({ version: 1, accounts: [account], projects: [] }),
    );
    await expect(loadStore(root)).rejects.toBeInstanceOf(StoreCorruptError);
  });

  it.each([
    ['a null entry', null],
    ['a non-string path', { id: 'p1', path: 1, accountId: 'a1' }],
    ['a missing accountId', { id: 'p1', path: '/repo' }],
  ])('loadStore rejects a project that is %s', async (_name, project) => {
    await writeFile(
      join(root, 'store.json'),
      JSON.stringify({ version: 1, accounts: [], projects: [project] }),
    );
    await expect(loadStore(root)).rejects.toBeInstanceOf(StoreCorruptError);
  });

  const goodSession = {
    id: 's1',
    projectId: 'p1',
    parentId: null,
    title: 'Chat',
    providerSessionId: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };

  it('loadStore accepts a store without sessions and with valid sessions', async () => {
    await writeFile(
      join(root, 'store.json'),
      JSON.stringify({ version: 1, accounts: [], projects: [] }),
    );
    expect((await loadStore(root)).sessions).toBeUndefined();
    const withSessions = {
      version: 1,
      accounts: [],
      projects: [],
      sessions: [goodSession, { ...goodSession, id: 's2', parentId: 's1', providerSessionId: 'x' }],
    };
    await writeFile(join(root, 'store.json'), JSON.stringify(withSessions));
    expect(await loadStore(root)).toEqual(withSessions);
  });

  it.each([
    ['a non-array sessions field', 'nope'],
    ['a null entry', null],
    ['an empty id', { ...goodSession, id: '' }],
    ['a dotdot id', { ...goodSession, id: '..' }],
    ['an id with a slash', { ...goodSession, id: 'a/b' }],
    ['an id with a backslash', { ...goodSession, id: 'a\\b' }],
    ['a non-string title', { ...goodSession, title: 1 }],
    ['a numeric parentId', { ...goodSession, parentId: 1 }],
    ['a missing providerSessionId', { ...goodSession, providerSessionId: undefined }],
    ['a missing updatedAt', { ...goodSession, updatedAt: undefined }],
  ])('loadStore rejects sessions with %s', async (_name, session) => {
    const sessions = typeof session === 'string' ? session : [session];
    await writeFile(
      join(root, 'store.json'),
      JSON.stringify({ version: 1, accounts: [], projects: [], sessions }),
    );
    await expect(loadStore(root)).rejects.toBeInstanceOf(StoreCorruptError);
  });

  it('dataRoot prefers INOVA_HOME', () => {
    expect(dataRoot({ INOVA_HOME: '/x' })).toBe('/x');
    expect(dataRoot({})).toBe(join(homedir(), '.inova'));
  });

  it('dataRoot falls back to the default when INOVA_HOME is empty', () => {
    expect(dataRoot({ INOVA_HOME: '' })).toBe(join(homedir(), '.inova'));
  });

  it('dataRoot resolves a relative INOVA_HOME to an absolute path', () => {
    expect(dataRoot({ INOVA_HOME: 'rel/dir' })).toBe(resolve('rel/dir'));
  });
});
