import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { CommandRunner } from '@inova/core/providers';
import { saveStore } from '@inova/core/store';
import { createLibraryHandlers } from '../src/main/library-handlers.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(id: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'inova-nonslug-')));
  dirs.push(root);
  await saveStore(root, { version: 1, accounts: [], projects: [] });
  await mkdir(join(root, 'library'), { recursive: true });
  const item = {
    id,
    kind: 'mcp',
    name: 'Odd',
    description: null,
    enabled: true,
    source: 'created',
    updatedAt: '2026-11-17T10:00:00.000Z',
    definition: { command: 'odd-server' },
  };
  await writeFile(
    join(root, 'library', 'library.json'),
    JSON.stringify({ version: 1, items: [item] }),
  );
  const run = vi.fn<CommandRunner['run']>(async () => ({ notFound: true }));
  return createLibraryHandlers({ root, baseEnv: async () => ({}), runner: { run } });
}

test('removeLibraryItem removes an item whose id is not a slug', async () => {
  const handlers = await setup('Bad Id');
  const removed = await handlers.removeLibraryItem({ id: 'Bad Id' });
  expect(removed).toEqual({ ok: true, value: { removed: true } });
  const listing = await handlers.listLibrary();
  expect(listing.ok && listing.value.invalidItems).toEqual([]);
});

test.each(['..', '.', 'a/b', 'a\\b'])('removeLibraryItem still refuses %s', async (id) => {
  const handlers = await setup('Bad Id');
  const result = await handlers.removeLibraryItem({ id });
  expect(result.ok).toBe(false);
});
