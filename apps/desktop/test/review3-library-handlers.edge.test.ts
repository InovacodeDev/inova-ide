import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CommandRunner } from '@inova/core/providers';
import { saveStore } from '@inova/core/store';
import type { Account } from '@inova/core/types';
import { createLibraryHandlers } from '../src/main/library-handlers.js';
import type { Result } from '../src/shared/api.js';

const SECRET = `ghp_${'a1B2'.repeat(9)}`;
const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-review3-handlers-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function rawItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'good-one',
    kind: 'mcp',
    name: 'Good',
    description: null,
    enabled: true,
    source: 'created',
    updatedAt: '2026-11-17T10:00:00.000Z',
    definition: { command: 'good-server' },
    ...overrides,
  };
}

function badItem(): Record<string, unknown> {
  return rawItem({
    id: 'bad-one',
    definition: { command: 'bad-server', args: [`--token=${SECRET}`] },
  });
}

async function setup(items: unknown[]) {
  const root = await tmp();
  const account: Account = {
    id: 'acc-claude',
    provider: 'claude',
    label: 'claude',
    homeDir: await tmp(),
    createdAt: '2026-11-17T10:00:00.000Z',
  };
  await saveStore(root, {
    version: 1,
    accounts: [account],
    projects: [{ id: 'proj-1', path: await tmp(), accountId: account.id }],
  });
  await mkdir(join(root, 'library'), { recursive: true });
  await writeFile(
    join(root, 'library', 'library.json'),
    JSON.stringify({ version: 1, items }, null, 2),
  );
  const run = vi.fn<CommandRunner['run']>(async () => ({ notFound: true }));
  const handlers = createLibraryHandlers({ root, baseEnv: async () => ({}), runner: { run } });
  return { root, handlers, homeDir: account.homeDir };
}

describe('biblioteca com item inválido', () => {
  test('listLibrary devolve os itens válidos e os inválidos sem o valor do segredo', async () => {
    const { handlers } = await setup([rawItem(), badItem()]);
    const listing = unwrap(await handlers.listLibrary());
    expect(listing.items.map((item) => item.id)).toEqual(['good-one']);
    expect(listing.invalidItems).toHaveLength(1);
    expect(listing.invalidItems[0]?.id).toBe('bad-one');
    expect(JSON.stringify(listing)).not.toContain(SECRET);
  });

  test('listLibrary devolve invalidItems vazio quando tudo é válido', async () => {
    const { handlers } = await setup([rawItem()]);
    expect(unwrap(await handlers.listLibrary()).invalidItems).toEqual([]);
  });

  test('previewLibrarySync usa só os itens válidos', async () => {
    const { handlers } = await setup([rawItem(), badItem()]);
    const preview = unwrap(await handlers.previewLibrarySync({ projectId: 'proj-1' }));
    const serialized = JSON.stringify(preview);
    expect(serialized).toContain('good-server');
    expect(serialized).not.toContain('bad-server');
    expect(serialized).not.toContain(SECRET);
  });

  test('applyLibrarySync não projeta o item inválido', async () => {
    const { homeDir, handlers } = await setup([rawItem(), badItem()]);
    const preview = unwrap(await handlers.previewLibrarySync({ projectId: 'proj-1' }));
    const approvedIds = preview.items.map((item) => item.approvalKey);
    unwrap(await handlers.applyLibrarySync({ projectId: 'proj-1', approvedIds }));
    const target = await readFile(join(homeDir, '.claude.json'), 'utf8');
    expect(target).toContain('good-server');
    expect(target).not.toContain('bad-server');
    expect(target).not.toContain(SECRET);
  });

  test('um id fora do formato de slug aparece como inválido', async () => {
    const { handlers } = await setup([rawItem({ id: 'Bad Id' })]);
    const listing = unwrap(await handlers.listLibrary());
    expect(listing.items).toEqual([]);
    expect(listing.invalidItems.map((item) => item.id)).toEqual(['Bad Id']);
  });

  test('removeLibraryItem remove o item inválido e mantém o válido', async () => {
    const { handlers } = await setup([rawItem(), badItem()]);
    expect(unwrap(await handlers.removeLibraryItem({ id: 'bad-one' }))).toEqual({ removed: true });
    const listing = unwrap(await handlers.listLibrary());
    expect(listing.items.map((item) => item.id)).toEqual(['good-one']);
    expect(listing.invalidItems).toEqual([]);
  });

  test('saveLibraryItem cria um item novo sem travar e preserva o inválido', async () => {
    const { handlers } = await setup([badItem()]);
    unwrap(
      await handlers.saveLibraryItem({
        id: 'fresh-one',
        name: 'Fresh',
        description: null,
        enabled: true,
        kind: 'mcp',
        definition: { command: 'npx', args: ['demo'] },
      }),
    );
    const listing = unwrap(await handlers.listLibrary());
    expect(listing.items.map((item) => item.id)).toEqual(['fresh-one']);
    expect(listing.invalidItems.map((item) => item.id)).toEqual(['bad-one']);
  });

  test('um id duplicado continua sendo biblioteca corrompida', async () => {
    const { handlers } = await setup([rawItem(), rawItem()]);
    const result = await handlers.listLibrary();
    expect(result.ok).toBe(false);
  });
});
