import type * as FsPromises from 'node:fs/promises';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveEffectiveItems } from './effective.js';
import { installSkillFromText } from './skills.js';
import { loadLibrary, removeLibraryItem, saveLibraryItem, skillDir } from './store.js';
import type { LibraryItem } from './types.js';

const cpControl = vi.hoisted(() => ({ fail: false }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    cp: vi.fn(async (...args: Parameters<typeof actual.cp>) => {
      if (cpControl.fail) throw new Error('disk full');
      return actual.cp(...args);
    }),
  };
});

const NOW = () => new Date('2026-11-17T10:00:00.000Z');
const SKILL_TEXT = '---\nname: sk\ndescription: Skill\n---\n\nPrecious body\n';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inova-review-backup-'));
  cpControl.fail = false;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function addSkill(): Promise<void> {
  const { hash } = await installSkillFromText({ root, id: 'sk', content: SKILL_TEXT, now: NOW });
  await saveLibraryItem({
    root,
    item: {
      id: 'sk',
      kind: 'skill',
      name: 'Skill',
      description: null,
      enabled: true,
      source: 'created',
      definition: { hash },
      updatedAt: NOW().toISOString(),
    },
    now: NOW,
  });
}

describe('removing a skill item keeps its content in the backup', () => {
  it('copies the skill folder next to library.json before deleting it', async () => {
    await addSkill();
    await removeLibraryItem({ root, id: 'sk', now: NOW });
    const backups = join(root, 'backups', 'library');
    const copies: string[] = [];
    for (const name of await readdir(backups)) {
      const copy = join(backups, name, 'skills', 'sk', 'SKILL.md');
      if (
        await stat(copy).then(
          () => true,
          () => false,
        )
      )
        copies.push(await readFile(copy, 'utf8'));
    }
    expect(copies).toEqual([SKILL_TEXT]);
    expect(
      await stat(skillDir(root, 'sk')).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect((await loadLibrary(root)).items).toEqual([]);
  });

  it('keeps one backup directory per removal', async () => {
    await addSkill();
    await removeLibraryItem({ root, id: 'sk', now: NOW });
    const [only, ...rest] = await readdir(join(root, 'backups', 'library'));
    expect(rest).toEqual([]);
    expect((await readdir(join(root, 'backups', 'library', only ?? ''))).sort()).toEqual([
      'library.json',
      'skills',
    ]);
  });

  it('removes an item whose skill folder is already missing', async () => {
    await addSkill();
    await rm(skillDir(root, 'sk'), { recursive: true });
    await expect(removeLibraryItem({ root, id: 'sk', now: NOW })).resolves.toEqual({
      removed: true,
    });
  });

  it('keeps the folder and the library item when the backup fails', async () => {
    await addSkill();
    cpControl.fail = true;
    await expect(removeLibraryItem({ root, id: 'sk', now: NOW })).rejects.toThrow('disk full');
    expect((await loadLibrary(root)).items.map((item) => item.id)).toEqual(['sk']);
    expect(await readFile(join(skillDir(root, 'sk'), 'SKILL.md'), 'utf8')).toBe(SKILL_TEXT);
  });
});

describe('resolveEffectiveItems with account-disabled connectors', () => {
  const connector: LibraryItem = {
    id: 'conn',
    kind: 'connector',
    name: 'Conn',
    label: 'Conn',
    description: null,
    enabled: true,
    source: 'created',
    definition: { type: 'http', url: 'https://x.example/mcp' },
    updatedAt: NOW().toISOString(),
  };
  const mcp: LibraryItem = {
    id: 'conn',
    kind: 'mcp',
    name: 'Conn',
    description: null,
    enabled: true,
    source: 'created',
    definition: { command: 'node' },
    updatedAt: NOW().toISOString(),
  };

  function effective(items: LibraryItem[], kind: 'mcp' | 'connector'): LibraryItem[] {
    return resolveEffectiveItems({
      items,
      projectDisabled: [],
      accountDisabled: [{ kind, id: 'conn' }],
    });
  }

  it('drops a connector disabled as mcp or as connector', () => {
    expect(effective([connector], 'mcp')).toEqual([]);
    expect(effective([connector], 'connector')).toEqual([]);
  });

  it('keeps an mcp item when only a connector ref matches its id', () => {
    expect(effective([mcp], 'connector')).toEqual([mcp]);
  });

  it('keeps a connector with a different id', () => {
    const other = { ...connector, id: 'other' };
    expect(effective([other], 'mcp')).toEqual([other]);
  });
});
