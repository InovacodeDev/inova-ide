import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PathNotFoundError, setProjectLibraryOverride } from '../projects.js';
import { loadStore, saveStore, StoreCorruptError } from '../store.js';
import {
  LibraryCorruptError,
  LibraryItemNotFoundError,
  LibraryValidationError,
  loadLibrary,
  libraryFile,
  removeLibraryItem,
  saveLibraryItem,
  setLibraryItemEnabled,
  skillDir,
  validateLibraryItem,
  type LibraryItem,
} from './index.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inova-library-edge-'));
});

afterEach(async () => {
  await chmod(join(root, 'library'), 0o700).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

const UPDATED_AT = '2026-11-17T10:00:00.000Z';

function baseItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'item',
    kind: 'skill',
    name: 'Item',
    description: null,
    enabled: true,
    source: 'created',
    definition: { hash: 'a1b2c3d4e5f60718' },
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function skill(id: string): LibraryItem {
  return baseItem({ id, name: id }) as unknown as LibraryItem;
}

function mcp(definition: unknown): Record<string, unknown> {
  return baseItem({ kind: 'mcp', definition });
}

function connector(definition: unknown): Record<string, unknown> {
  return baseItem({ kind: 'connector', label: 'Remote', definition });
}

async function writeLibraryFile(content: string): Promise<void> {
  await mkdir(join(root, 'library'), { recursive: true });
  await writeFile(libraryFile(root), content);
}

async function libraryDirEntries(): Promise<string[]> {
  return readdir(join(root, 'library'));
}

describe('validateLibraryItem: common fields', () => {
  const invalidIds = ['../x', 'A', '', 'a'.repeat(65), 'a--b', '-a', 'a_b', 'a/b'];
  for (const id of invalidIds) {
    it(`rejects id ${JSON.stringify(id)}`, () => {
      expect(validateLibraryItem(baseItem({ id })).ok).toBe(false);
    });
  }

  it('accepts a 64 character id', () => {
    expect(validateLibraryItem(baseItem({ id: 'a'.repeat(64) })).ok).toBe(true);
  });

  const invalidFields: Record<string, Record<string, unknown>> = {
    'empty name': { name: '' },
    'name over 100 characters': { name: 'n'.repeat(101) },
    'description over 500 characters': { description: 'd'.repeat(501) },
    'description that is not a string': { description: 3 },
    'unknown kind': { kind: 'theme' },
    'enabled that is not a boolean': { enabled: 'yes' },
    'unknown source': { source: 'bundled' },
    'updatedAt that is not ISO': { updatedAt: 'yesterday' },
    'skill hash that is not hexadecimal': { definition: { hash: '../../etc' } },
    'name that carries a secret': { name: 'Bearer sk-live-123456' },
  };
  for (const [label, overrides] of Object.entries(invalidFields)) {
    it(`rejects ${label}`, () => {
      expect(validateLibraryItem(baseItem(overrides)).ok).toBe(false);
    });
  }

  it('rejects input that is not an object', () => {
    for (const input of [null, undefined, 'item', 3, []]) {
      expect(validateLibraryItem(input).ok).toBe(false);
    }
  });

  it('does not copy unknown fields into the result', () => {
    const result = validateLibraryItem(
      baseItem({ extra: 'x', definition: { hash: 'abcdef01', x: 1 } }),
    );
    expect(result.ok && result.item).toEqual({
      id: 'item',
      kind: 'skill',
      name: 'Item',
      description: null,
      enabled: true,
      source: 'created',
      definition: { hash: 'abcdef01' },
      updatedAt: UPDATED_AT,
    });
  });
});

describe('validateLibraryItem: mcp and connector', () => {
  it('rejects __proto__ as an env key', () => {
    const env: unknown = JSON.parse('{"__proto__":"${TOKEN}"}');
    expect(validateLibraryItem(mcp({ command: 'npx', env })).ok).toBe(false);
  });

  it('rejects constructor, prototype and empty env keys', () => {
    for (const key of ['constructor', 'prototype', '']) {
      expect(validateLibraryItem(mcp({ command: 'npx', env: { [key]: '${TOKEN}' } })).ok).toBe(
        false,
      );
    }
  });

  it('rejects env keys over 100 characters and more than 50 entries', () => {
    expect(
      validateLibraryItem(mcp({ command: 'npx', env: { ['K'.repeat(101)]: '${TOKEN}' } })).ok,
    ).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`K${i}`, '${TOKEN}']));
    expect(validateLibraryItem(mcp({ command: 'npx', env: many })).ok).toBe(false);
  });

  it('rejects values that only look like references', () => {
    for (const value of ['${TOKEN} extra', 'x${TOKEN}', '$TOKEN', '${1TOKEN}', 'Bearer  ${T}']) {
      expect(validateLibraryItem(mcp({ command: 'npx', env: { KEY: value } })).ok).toBe(false);
    }
  });

  it('enforces command and args limits', () => {
    expect(validateLibraryItem(mcp({ command: '' })).ok).toBe(false);
    expect(validateLibraryItem(mcp({ command: 'c'.repeat(501) })).ok).toBe(false);
    expect(validateLibraryItem(mcp({ command: 'npx', args: Array(51).fill('a') })).ok).toBe(false);
    expect(validateLibraryItem(mcp({ command: 'npx', args: ['a'.repeat(1001)] })).ok).toBe(false);
    expect(validateLibraryItem(mcp({ command: 'npx', args: [1] })).ok).toBe(false);
  });

  it('accepts stdio and remote mcp definitions', () => {
    expect(validateLibraryItem(mcp({ type: 'stdio', command: 'npx', args: ['a'] })).ok).toBe(true);
    expect(validateLibraryItem(mcp({ type: 'http', url: 'https://example.com/mcp' })).ok).toBe(
      true,
    );
    expect(validateLibraryItem(mcp({ type: 'ws', url: 'wss://example.com' })).ok).toBe(false);
  });

  const invalidUrls: Record<string, string> = {
    'credentials in the url': 'https://user:pass@example.com/mcp',
    'user without password': 'https://user@example.com/mcp',
    'file protocol': 'file:///etc/passwd',
    'ftp protocol': 'ftp://example.com/mcp',
    'not a url': 'not a url',
    'literal query value': 'https://example.com/mcp?token=abc',
    'query key without value': 'https://example.com/mcp?abc',
    fragment: 'https://example.com/mcp#abc',
    'url over 2000 characters': `https://example.com/${'a'.repeat(2000)}`,
  };
  for (const [label, url] of Object.entries(invalidUrls)) {
    it(`rejects ${label}`, () => {
      expect(validateLibraryItem(connector({ type: 'http', url })).ok).toBe(false);
    });
  }

  it('rejects a stdio connector', () => {
    expect(validateLibraryItem(connector({ command: 'npx' })).ok).toBe(false);
    expect(validateLibraryItem(connector({ type: 'stdio', command: 'npx' })).ok).toBe(false);
  });

  it('requires a connector label', () => {
    const noLabel = { ...connector({ type: 'http', url: 'https://example.com' }), label: '' };
    expect(validateLibraryItem(noLabel).ok).toBe(false);
  });
});

describe('validateLibraryItem: plugin', () => {
  function plugin(definition: unknown): Record<string, unknown> {
    return baseItem({ kind: 'plugin', definition });
  }

  it('accepts a plugin with and without marketplace', () => {
    expect(validateLibraryItem(plugin({ provider: 'claude', name: 'my-plugin' })).ok).toBe(true);
    expect(
      validateLibraryItem(plugin({ provider: 'codex', marketplace: 'acme.market', name: 'p' })).ok,
    ).toBe(true);
  });

  it('rejects unknown provider, bad names and bad marketplace', () => {
    expect(validateLibraryItem(plugin({ provider: 'toString', name: 'p' })).ok).toBe(false);
    expect(validateLibraryItem(plugin({ provider: 'claude', name: '../p' })).ok).toBe(false);
    expect(validateLibraryItem(plugin({ provider: 'claude', name: '-p' })).ok).toBe(false);
    expect(validateLibraryItem(plugin({ provider: 'claude', name: 'p'.repeat(101) })).ok).toBe(
      false,
    );
    expect(
      validateLibraryItem(plugin({ provider: 'claude', name: 'p', marketplace: 'a b' })).ok,
    ).toBe(false);
  });
});

describe('library store', () => {
  it('returns an empty library when the file is missing', async () => {
    expect(await loadLibrary(root)).toEqual({ version: 1, items: [] });
  });

  const corrupt: Record<string, string> = {
    'invalid JSON': '{not json',
    'wrong version': JSON.stringify({ version: 2, items: [] }),
    'items that is not an array': JSON.stringify({ version: 1, items: {} }),
    'invalid item': JSON.stringify({ version: 1, items: [baseItem({ id: 'A' })] }),
    'duplicate ids': JSON.stringify({ version: 1, items: [baseItem(), baseItem()] }),
    'literal secret in env': JSON.stringify({
      version: 1,
      items: [mcp({ command: 'npx', env: { KEY: 'sk-live-123456' } })],
    }),
  };
  for (const [label, content] of Object.entries(corrupt)) {
    it(`throws LibraryCorruptError on ${label} and refuses to overwrite the file`, async () => {
      await writeLibraryFile(content);
      const error = await loadLibrary(root).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LibraryCorruptError);
      expect((error as LibraryCorruptError).path).toBe(libraryFile(root));
      await expect(saveLibraryItem({ root, item: skill('new-item') })).rejects.toBeInstanceOf(
        LibraryCorruptError,
      );
      expect(await readFile(libraryFile(root), 'utf8')).toBe(content);
    });
  }

  it('rejects an invalid item with LibraryValidationError', async () => {
    const item = baseItem({ id: '../x' }) as unknown as LibraryItem;
    await expect(saveLibraryItem({ root, item })).rejects.toBeInstanceOf(LibraryValidationError);
  });

  it('upserts by id keeping order and sets updatedAt from now', async () => {
    const now = (): Date => new Date('2026-12-01T08:09:10.000Z');
    await saveLibraryItem({ root, item: skill('a'), now });
    await saveLibraryItem({ root, item: skill('b'), now });
    const saved = await saveLibraryItem({
      root,
      item: { ...skill('a'), name: 'Renamed' } as LibraryItem,
      now,
    });
    expect(saved.updatedAt).toBe('2026-12-01T08:09:10.000Z');
    const { items } = await loadLibrary(root);
    expect(items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(items[0]?.name).toBe('Renamed');
  });

  it('keeps every item when 20 saves run concurrently', async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `item-${index}`);
    await Promise.all(ids.map((id) => saveLibraryItem({ root, item: skill(id) })));
    const { items } = await loadLibrary(root);
    expect(items.map((item) => item.id).sort()).toEqual([...ids].sort());
    expect((await libraryDirEntries()).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(await readdir(join(root, 'backups', 'library'))).toHaveLength(19);
  });

  it('writes the file with mode 0600 and directories with mode 0700', async () => {
    await saveLibraryItem({ root, item: skill('a') });
    await saveLibraryItem({ root, item: skill('b') });
    expect((await stat(libraryFile(root))).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, 'library'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, 'backups', 'library'))).mode & 0o777).toBe(0o700);
  });

  it('leaves the previous file intact when the backup directory cannot be created', async () => {
    await saveLibraryItem({ root, item: skill('a') });
    const before = await readFile(libraryFile(root), 'utf8');
    await writeFile(join(root, 'backups'), 'not a directory');
    await expect(saveLibraryItem({ root, item: skill('b') })).rejects.toThrow();
    expect(await readFile(libraryFile(root), 'utf8')).toBe(before);
    expect((await libraryDirEntries()).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('leaves the previous file intact and no temp file when the write fails', async () => {
    await saveLibraryItem({ root, item: skill('a') });
    const before = await readFile(libraryFile(root), 'utf8');
    await chmod(join(root, 'library'), 0o500);
    await expect(saveLibraryItem({ root, item: skill('b') })).rejects.toThrow();
    await chmod(join(root, 'library'), 0o700);
    expect(await readFile(libraryFile(root), 'utf8')).toBe(before);
    expect((await libraryDirEntries()).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps working for later saves after a failed save', async () => {
    await writeFile(join(root, 'backups'), 'not a directory');
    await saveLibraryItem({ root, item: skill('a') });
    await expect(saveLibraryItem({ root, item: skill('b') })).rejects.toThrow();
    await rm(join(root, 'backups'));
    await saveLibraryItem({ root, item: skill('c') });
    expect((await loadLibrary(root)).items.map((item) => item.id)).toEqual(['a', 'c']);
  });
});

describe('removeLibraryItem and setLibraryItemEnabled', () => {
  it('returns removed false and writes nothing for an unknown id', async () => {
    expect(await removeLibraryItem({ root, id: 'ghost' })).toEqual({ removed: false });
    expect(await readdir(root)).toEqual([]);
    await saveLibraryItem({ root, item: skill('a') });
    const before = await readFile(libraryFile(root), 'utf8');
    expect(await removeLibraryItem({ root, id: 'ghost' })).toEqual({ removed: false });
    expect(await readFile(libraryFile(root), 'utf8')).toBe(before);
    expect(await readdir(join(root, 'backups', 'library')).catch(() => [])).toEqual([]);
  });

  it('removes only the skill directory of the removed item', async () => {
    await saveLibraryItem({ root, item: skill('keep') });
    await saveLibraryItem({ root, item: skill('drop') });
    await mkdir(skillDir(root, 'keep'), { recursive: true });
    await mkdir(skillDir(root, 'drop'), { recursive: true });
    await writeFile(join(skillDir(root, 'keep'), 'SKILL.md'), 'keep');
    await writeFile(join(skillDir(root, 'drop'), 'SKILL.md'), 'drop');

    expect(await removeLibraryItem({ root, id: 'drop' })).toEqual({ removed: true });

    expect(await readdir(join(root, 'library', 'skills'))).toEqual(['keep']);
    expect(await readFile(join(skillDir(root, 'keep'), 'SKILL.md'), 'utf8')).toBe('keep');
    expect((await loadLibrary(root)).items.map((item) => item.id)).toEqual(['keep']);
  });

  it('does not follow symlinks when it removes a skill directory', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'precious.txt'), 'data');
    await saveLibraryItem({ root, item: skill('drop') });
    await mkdir(skillDir(root, 'drop'), { recursive: true });
    await symlink(outside, join(skillDir(root, 'drop'), 'link'));

    await removeLibraryItem({ root, id: 'drop' });

    expect(await readFile(join(outside, 'precious.txt'), 'utf8')).toBe('data');
  });

  it('does not touch a skills directory when the removed item is not a skill', async () => {
    await saveLibraryItem({
      root,
      item: { ...skill('server'), kind: 'mcp', definition: { command: 'npx' } } as LibraryItem,
    });
    await mkdir(join(root, 'library', 'skills', 'server'), { recursive: true });
    await removeLibraryItem({ root, id: 'server' });
    expect(await readdir(join(root, 'library', 'skills'))).toEqual(['server']);
  });

  it('refuses a skill directory outside the skills root', () => {
    for (const id of ['..', '../x', '', '.']) {
      expect(() => skillDir(root, id)).toThrow(LibraryValidationError);
    }
  });

  it('toggles enabled and throws for an unknown id', async () => {
    await saveLibraryItem({ root, item: skill('a') });
    const updated = await setLibraryItemEnabled({ root, id: 'a', enabled: false });
    expect(updated.enabled).toBe(false);
    expect((await loadLibrary(root)).items[0]?.enabled).toBe(false);
    await expect(
      setLibraryItemEnabled({ root, id: 'ghost', enabled: true }),
    ).rejects.toBeInstanceOf(LibraryItemNotFoundError);
  });
});

describe('project library overrides', () => {
  async function seedProject(extra: Record<string, unknown> = {}): Promise<void> {
    await saveStore(root, {
      version: 1,
      accounts: [],
      projects: [{ id: 'p1', path: '/repo', accountId: 'a1', ...extra }],
    });
  }

  const invalidOverrides: Record<string, unknown> = {
    'not an object': 'x',
    'disabled that is not an array': { disabled: 'a' },
    'invalid slug': { disabled: ['A'] },
    'non string entry': { disabled: [1] },
    'entry over 64 characters': { disabled: ['a'.repeat(65)] },
    'more than 200 entries': { disabled: Array.from({ length: 201 }, (_, i) => `item-${i}`) },
  };
  for (const [label, libraryOverrides] of Object.entries(invalidOverrides)) {
    it(`store rejects libraryOverrides with ${label}`, async () => {
      await seedProject({ libraryOverrides });
      await expect(loadStore(root)).rejects.toBeInstanceOf(StoreCorruptError);
    });
  }

  it('store accepts a project without overrides and with valid overrides', async () => {
    await seedProject();
    expect((await loadStore(root)).projects[0]?.libraryOverrides).toBeUndefined();
    await seedProject({ libraryOverrides: { disabled: ['a', 'b-c'] } });
    expect((await loadStore(root)).projects[0]?.libraryOverrides).toEqual({
      disabled: ['a', 'b-c'],
    });
  });

  it('adds and removes an id without duplicating and keeps order', async () => {
    await seedProject();
    const toggle = (itemId: string, disabled: boolean) =>
      setProjectLibraryOverride({ root, projectId: 'p1', itemId, disabled });
    await toggle('a', true);
    await toggle('b', true);
    await toggle('a', true);
    expect((await loadStore(root)).projects[0]?.libraryOverrides).toEqual({
      disabled: ['a', 'b'],
    });
    await toggle('a', false);
    await toggle('a', false);
    expect((await loadStore(root)).projects[0]?.libraryOverrides).toEqual({ disabled: ['b'] });
  });

  it('does not create an override when enabling an item that was never disabled', async () => {
    await seedProject();
    await setProjectLibraryOverride({ root, projectId: 'p1', itemId: 'a', disabled: false });
    expect((await loadStore(root)).projects[0]?.libraryOverrides).toBeUndefined();
  });

  it('keeps concurrent overrides', async () => {
    await seedProject();
    const ids = Array.from({ length: 10 }, (_, index) => `item-${index}`);
    await Promise.all(
      ids.map((itemId) =>
        setProjectLibraryOverride({ root, projectId: 'p1', itemId, disabled: true }),
      ),
    );
    const disabled = (await loadStore(root)).projects[0]?.libraryOverrides?.disabled ?? [];
    expect([...disabled].sort()).toEqual([...ids].sort());
  });

  it('throws for an unknown project', async () => {
    await seedProject();
    await expect(
      setProjectLibraryOverride({ root, projectId: 'ghost', itemId: 'a', disabled: true }),
    ).rejects.toBeInstanceOf(PathNotFoundError);
  });

  it('rejects an invalid id or a 201st id without corrupting the store', async () => {
    await seedProject({
      libraryOverrides: { disabled: Array.from({ length: 200 }, (_, i) => `item-${i}`) },
    });
    for (const itemId of ['../x', 'A', '', 'new-item']) {
      await expect(
        setProjectLibraryOverride({ root, projectId: 'p1', itemId, disabled: true }),
      ).rejects.toThrow();
    }
    expect((await loadStore(root)).projects[0]?.libraryOverrides?.disabled).toHaveLength(200);
  });
});
