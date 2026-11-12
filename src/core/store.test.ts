import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('dataRoot prefers INOVA_HOME', () => {
    expect(dataRoot({ INOVA_HOME: '/x' })).toBe('/x');
    expect(dataRoot({})).toBe(join(homedir(), '.inova'));
  });
});
