import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installSkillFromText } from './skills.js';
import {
  LibraryCorruptError,
  libraryFile,
  loadLibrary,
  loadLibraryWithInvalid,
  removeLibraryItem,
  saveLibraryItem,
  setLibraryItemEnabled,
  skillDir,
} from './store.js';
import type { LibraryItem } from './types.js';

const NOW = () => new Date('2026-11-17T10:00:00.000Z');
const SECRET = `ghp_${'a1B2'.repeat(9)}`;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inova-review3-quarantine-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'good-one',
    kind: 'mcp',
    name: 'Good',
    description: null,
    enabled: true,
    source: 'created',
    updatedAt: '2026-11-17T10:00:00.000Z',
    definition: { command: 'npx' },
    ...overrides,
  };
}

function bad(id = 'bad-one'): Record<string, unknown> {
  return entry({ id, definition: { command: 'npx', args: [`--token=${SECRET}`] } });
}

async function writeItems(items: unknown[]): Promise<string> {
  await mkdir(join(root, 'library'), { recursive: true });
  const content = `${JSON.stringify({ version: 1, items }, null, 2)}\n`;
  await writeFile(libraryFile(root), content);
  return content;
}

async function fileItems(): Promise<Record<string, unknown>[]> {
  const parsed = JSON.parse(await readFile(libraryFile(root), 'utf8')) as {
    items: Record<string, unknown>[];
  };
  return parsed.items;
}

describe('loadLibraryWithInvalid', () => {
  it('splits valid items from semantically invalid ones without echoing values', async () => {
    await writeItems([entry(), bad()]);
    const loaded = await loadLibraryWithInvalid(root);
    expect(loaded.library.items.map((item) => item.id)).toEqual(['good-one']);
    expect(loaded.invalid).toHaveLength(1);
    expect(loaded.invalid[0]?.id).toBe('bad-one');
    expect(loaded.invalid[0]?.error).not.toContain(SECRET);
    expect(loaded.invalid[0]?.error).toContain('secrets');
  });

  it('loadLibrary returns only the valid items instead of throwing', async () => {
    await writeItems([bad(), entry()]);
    expect((await loadLibrary(root)).items.map((item) => item.id)).toEqual(['good-one']);
  });

  it('quarantines an item whose id is not a valid slug', async () => {
    await writeItems([entry({ id: 'Bad Id' })]);
    const loaded = await loadLibraryWithInvalid(root);
    expect(loaded.library.items).toEqual([]);
    expect(loaded.invalid.map((item) => item.id)).toEqual(['Bad Id']);
  });

  it('returns an empty result when the file is missing', async () => {
    expect(await loadLibraryWithInvalid(root)).toEqual({
      library: { version: 1, items: [] },
      invalid: [],
    });
  });

  it.each([
    ['duplicate ids across valid and invalid', () => [entry(), bad('good-one')]],
    ['item without a string id', () => [entry(), { name: 'x' }]],
    ['item with a numeric id', () => [entry({ id: 7 })]],
    ['item that is not an object', () => ['x']],
  ])('stays strict on %s', async (_name, build) => {
    const content = await writeItems(build());
    await expect(loadLibraryWithInvalid(root)).rejects.toBeInstanceOf(LibraryCorruptError);
    await expect(loadLibrary(root)).rejects.toBeInstanceOf(LibraryCorruptError);
    expect(await readFile(libraryFile(root), 'utf8')).toBe(content);
  });
});

describe('mutations keep invalid items instead of locking the library', () => {
  it('saves a new item and preserves the invalid one as it was', async () => {
    const original = bad();
    await writeItems([entry(), original]);
    await saveLibraryItem({ root, item: entry({ id: 'new-one' }) as unknown as LibraryItem });
    const items = await fileItems();
    expect(items.map((item) => item['id'])).toEqual(['good-one', 'new-one', 'bad-one']);
    expect(items[2]).toEqual(original);
  });

  it('overwrites an invalid id with a valid item', async () => {
    await writeItems([bad('same-id')]);
    await saveLibraryItem({ root, item: entry({ id: 'same-id' }) as unknown as LibraryItem });
    const loaded = await loadLibraryWithInvalid(root);
    expect(loaded.invalid).toEqual([]);
    expect(loaded.library.items.map((item) => item.id)).toEqual(['same-id']);
  });

  it('removes an invalid id, keeps the rest and writes a backup', async () => {
    await writeItems([entry(), bad()]);
    expect(await removeLibraryItem({ root, id: 'bad-one', now: NOW })).toEqual({ removed: true });
    expect((await fileItems()).map((item) => item['id'])).toEqual(['good-one']);
    expect(await readdir(join(root, 'backups', 'library'))).toHaveLength(1);
  });

  it('keeps the invalid item when another item is removed', async () => {
    await writeItems([entry(), bad()]);
    await removeLibraryItem({ root, id: 'good-one', now: NOW });
    expect((await fileItems()).map((item) => item['id'])).toEqual(['bad-one']);
  });

  it('returns removed false for an unknown id and writes nothing', async () => {
    const content = await writeItems([entry(), bad()]);
    expect(await removeLibraryItem({ root, id: 'ghost', now: NOW })).toEqual({ removed: false });
    expect(await readFile(libraryFile(root), 'utf8')).toBe(content);
  });

  it('toggles a valid item and preserves the invalid one', async () => {
    await writeItems([entry(), bad()]);
    await setLibraryItemEnabled({ root, id: 'good-one', enabled: false, now: NOW });
    const items = await fileItems();
    expect(items.map((item) => item['id'])).toEqual(['good-one', 'bad-one']);
    expect(items[0]?.['enabled']).toBe(false);
  });

  it('removes the skill folder of an invalid skill item after backing it up', async () => {
    const SKILL_TEXT = '---\nname: sk\ndescription: Skill\n---\n\nBody\n';
    await installSkillFromText({ root, id: 'sk', content: SKILL_TEXT, now: NOW });
    await writeItems([entry({ id: 'sk', kind: 'skill', definition: { hash: 'not hex' } })]);
    expect(await removeLibraryItem({ root, id: 'sk', now: NOW })).toEqual({ removed: true });
    await expect(stat(skillDir(root, 'sk'))).rejects.toThrow();
    const [only] = await readdir(join(root, 'backups', 'library'));
    expect(
      await readFile(
        join(root, 'backups', 'library', only ?? '', 'skills', 'sk', 'SKILL.md'),
        'utf8',
      ),
    ).toBe(SKILL_TEXT);
  });

  it('does not touch a skill folder when an invalid non-skill item is removed', async () => {
    const SKILL_TEXT = '---\nname: sk\ndescription: Skill\n---\n\nBody\n';
    await installSkillFromText({ root, id: 'sk', content: SKILL_TEXT, now: NOW });
    await writeItems([bad('sk')]);
    await removeLibraryItem({ root, id: 'sk', now: NOW });
    expect(await readFile(join(skillDir(root, 'sk'), 'SKILL.md'), 'utf8')).toBe(SKILL_TEXT);
  });
});

describe('the reviewer lockout scenario', () => {
  it('lets the user save and remove after an old item with auth none', async () => {
    await writeItems([
      entry(),
      entry({ id: 'old-one', definition: { command: 'npx', args: ['--auth', 'none'] } }),
    ]);
    expect((await loadLibraryWithInvalid(root)).invalid).toEqual([]);
    await saveLibraryItem({ root, item: entry({ id: 'new-one' }) as unknown as LibraryItem });
    expect(await removeLibraryItem({ root, id: 'old-one', now: NOW })).toEqual({ removed: true });
  });
});
