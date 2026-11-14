import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupFile,
  CapabilityFileError,
  setTomlArrayMembership,
  setTomlSkillConfig,
  setTomlTableKey,
  tomlTableHeader,
  updateJsonFile,
  updateTomlFile,
} from './file-edit.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'file-edit-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('backupFile', () => {
  it('does nothing when the source is missing', async () => {
    const backupRoot = join(dir, 'bk');
    await backupFile({ file: join(dir, 'nope.json'), backupRoot });
    expect(await readdir(backupRoot)).toEqual([]);
  });

  it('keeps same-named files from different dirs apart', async () => {
    const backupRoot = join(dir, 'bk');
    await mkdir(join(dir, 'a'));
    await mkdir(join(dir, 'b'));
    await writeFile(join(dir, 'a', 'c.json'), 'A');
    await writeFile(join(dir, 'b', 'c.json'), 'B');
    await backupFile({ file: join(dir, 'a', 'c.json'), backupRoot });
    await backupFile({ file: join(dir, 'b', 'c.json'), backupRoot });
    const contents = await Promise.all(
      (await readdir(backupRoot)).map((name) => readFile(join(backupRoot, name), 'utf8')),
    );
    expect(contents.sort()).toEqual(['A', 'B']);
  });
});

describe('updateJsonFile', () => {
  it('[RF-1] throws on invalid JSON and leaves the file intact', async () => {
    const file = join(dir, 'c.json');
    await writeFile(file, '{ nope');
    await expect(
      updateJsonFile({ file, backupRoot: join(dir, 'bk'), update: (root) => root }),
    ).rejects.toBeInstanceOf(CapabilityFileError);
    expect(await readFile(file, 'utf8')).toBe('{ nope');
  });

  it('creates {} when the file is missing', async () => {
    const file = join(dir, 'new', 'c.json');
    await updateJsonFile({
      file,
      backupRoot: join(dir, 'bk'),
      update: (root) => ({ ...root, a: 1 }),
    });
    expect(await readFile(file, 'utf8')).toBe('{\n  "a": 1\n}\n');
  });

  it('writes a backup of the original before changing it', async () => {
    const file = join(dir, 'c.json');
    const backupRoot = join(dir, 'bk');
    await writeFile(file, '{"a":1}');
    await updateJsonFile({ file, backupRoot, update: (root) => ({ ...root, a: 2 }) });
    const [name] = await readdir(backupRoot);
    expect(await readFile(join(backupRoot, name ?? ''), 'utf8')).toBe('{"a":1}');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ a: 2 });
  });
});

describe('tomlTableHeader', () => {
  it('[RF-2] quotes only segments that are not bare', () => {
    expect(tomlTableHeader(['mcp_servers', 'my.server'])).toBe('mcp_servers."my.server"');
    expect(tomlTableHeader(['plugins', 'github@openai-curated-remote'])).toBe(
      'plugins."github@openai-curated-remote"',
    );
    expect(tomlTableHeader(['a-b_1', 'c'])).toBe('a-b_1.c');
  });
});

describe('setTomlTableKey', () => {
  const other = '# keep\n[other]\nx = 1 # trailing\n';

  it('replaces an existing enabled value', () => {
    const toml = `${other}\n[t]\nenabled = true\nname = "n"\n`;
    expect(setTomlTableKey({ toml, table: 't', key: 'enabled', value: false })).toBe(
      `${other}\n[t]\nenabled = false\nname = "n"\n`,
    );
  });

  it('inserts enabled right after the header', () => {
    const toml = `[t]\nname = "n"\n${other}`;
    expect(setTomlTableKey({ toml, table: 't', key: 'enabled', value: false })).toBe(
      `[t]\nenabled = false\nname = "n"\n${other}`,
    );
  });

  it('appends the table when absent', () => {
    expect(setTomlTableKey({ toml: other, table: 't', key: 'enabled', value: false })).toBe(
      `${other}\n[t]\nenabled = false\n`,
    );
  });

  it('does not touch the same key in another table', () => {
    const toml = '[a]\nenabled = true\n[t]\nenabled = true\n';
    expect(setTomlTableKey({ toml, table: 't', key: 'enabled', value: false })).toBe(
      '[a]\nenabled = true\n[t]\nenabled = false\n',
    );
  });

  it('throws when the target table is defined inline', () => {
    const toml = 'mcp_servers = { x = { command = "a" } }\n';
    expect(() =>
      setTomlTableKey({ toml, table: 'mcp_servers.x', key: 'enabled', value: false }),
    ).toThrow(CapabilityFileError);
  });
});

describe('setTomlArrayMembership', () => {
  const toml = '[skills]\ndisabled = ["a"]\n';
  const base = { table: 'skills', key: 'disabled' };

  it('adds a member', () => {
    expect(setTomlArrayMembership({ ...base, toml, member: 'b', present: true })).toBe(
      '[skills]\ndisabled = ["a", "b"]\n',
    );
  });

  it('removes a member', () => {
    expect(setTomlArrayMembership({ ...base, toml, member: 'a', present: false })).toBe(
      '[skills]\ndisabled = []\n',
    );
  });

  it('creates the table when absent', () => {
    expect(setTomlArrayMembership({ ...base, toml: '', member: 'a', present: true })).toBe(
      '[skills]\ndisabled = ["a"]\n',
    );
  });

  it('throws on a multi-line array', () => {
    const multi = '[skills]\ndisabled = [\n  "a",\n]\n';
    expect(() =>
      setTomlArrayMembership({ ...base, toml: multi, member: 'b', present: true }),
    ).toThrow(CapabilityFileError);
  });
});

describe('setTomlSkillConfig', () => {
  it('adds a block when disabling and removes only that block when enabling', () => {
    const base = '[a]\nx = 1\n';
    const withA = setTomlSkillConfig({ toml: base, name: 'a', enabled: false });
    expect(withA).toBe(`${base}\n[[skills.config]]\nname = "a"\nenabled = false\n`);
    const withBoth = setTomlSkillConfig({ toml: withA, name: 'b', enabled: false });
    expect(withBoth).toContain('name = "b"');
    const onlyB = setTomlSkillConfig({ toml: withBoth, name: 'a', enabled: true });
    expect(onlyB).not.toContain('name = "a"');
    expect(onlyB).toContain('name = "b"');
    expect(setTomlSkillConfig({ toml: withA, name: 'a', enabled: true })).toBe(base);
  });

  it('does not duplicate an existing block', () => {
    const once = setTomlSkillConfig({ toml: '', name: 'a', enabled: false });
    expect(setTomlSkillConfig({ toml: once, name: 'a', enabled: false })).toBe(once);
  });
});

describe('updateTomlFile', () => {
  it('backs up and rewrites the file', async () => {
    const file = join(dir, 'c.toml');
    const backupRoot = join(dir, 'bk');
    await writeFile(file, 'a = 1\n');
    await updateTomlFile({ file, backupRoot, update: (toml) => `${toml}b = 2\n` });
    expect(await readFile(file, 'utf8')).toBe('a = 1\nb = 2\n');
    const [name] = await readdir(backupRoot);
    expect(await readFile(join(backupRoot, name ?? ''), 'utf8')).toBe('a = 1\n');
  });
});
