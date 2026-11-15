import {
  chmod,
  lstat,
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
import {
  backupFile,
  CapabilityFileError,
  listTomlTables,
  readTomlArrayMembers,
  readTomlTableKey,
  serialize,
  setTomlArrayMembership,
  setTomlSkillConfig,
  setTomlTableKey,
  tomlTableHeader,
  updateJsonFile,
  updateTomlFile,
  writeAtomic,
} from './file-edit.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'file-edit-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeAtomic', () => {
  it('writes through a symlink and keeps the link', async () => {
    const target = join(dir, 'real.json');
    const link = join(dir, 'link.json');
    await writeFile(target, 'old');
    await symlink(target, link);
    await writeAtomic(link, 'new');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('new');
  });

  it('keeps the mode of an existing file and uses 0600 for a new one', async () => {
    const existing = join(dir, 'a.json');
    await writeFile(existing, 'old', { mode: 0o644 });
    await chmod(existing, 0o644);
    await writeAtomic(existing, 'new');
    expect((await stat(existing)).mode & 0o777).toBe(0o644);
    const created = join(dir, 'b.json');
    await writeAtomic(created, 'x');
    expect((await stat(created)).mode & 0o777).toBe(0o600);
  });
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

  it('finds a header with a trailing comment', () => {
    expect(
      setTomlTableKey({
        toml: '[t] # note\nenabled = true\n',
        table: 't',
        key: 'enabled',
        value: false,
      }),
    ).toBe('[t] # note\nenabled = false\n');
  });

  it('finds a header with spaces inside the brackets', () => {
    expect(
      setTomlTableKey({ toml: '  [ t ]\nname = "n"\n', table: 't', key: 'enabled', value: false }),
    ).toBe('  [ t ]\nenabled = false\nname = "n"\n');
  });

  it('throws when an ancestor table defines the target as an inline key', () => {
    const toml = '[mcp_servers]\nx = { command = "a" }\n';
    expect(() =>
      setTomlTableKey({ toml, table: 'mcp_servers.x', key: 'enabled', value: false }),
    ).toThrow(CapabilityFileError);
  });

  it('throws when the root defines the target as a dotted key', () => {
    const toml = 'mcp_servers.x.command = "a"\n';
    expect(() =>
      setTomlTableKey({ toml, table: 'mcp_servers.x', key: 'enabled', value: false }),
    ).toThrow(CapabilityFileError);
  });

  it('appends when ancestor sections do not define the target', () => {
    const toml = '[mcp_servers]\ny = 1\n';
    expect(setTomlTableKey({ toml, table: 'mcp_servers.x', key: 'enabled', value: false })).toBe(
      `${toml}\n[mcp_servers.x]\nenabled = false\n`,
    );
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

  it('throws instead of dropping single-quoted members', () => {
    const single = "[skills]\ndisabled = ['a']\n";
    expect(() =>
      setTomlArrayMembership({ ...base, toml: single, member: 'b', present: true }),
    ).toThrow(CapabilityFileError);
  });

  it('throws a CapabilityFileError for an invalid escape in a member', () => {
    const bad = '[skills]\ndisabled = ["\\e"]\n';
    expect(() =>
      setTomlArrayMembership({ ...base, toml: bad, member: 'b', present: true }),
    ).toThrow(CapabilityFileError);
  });
});

describe('TOML readers', () => {
  it('lists canonical table paths, including quoted segments with # and ]', () => {
    const toml = '[a.b]\n["c"]\n[mcp_servers."my#srv"]\n[x."y]z"]\n[[arr]]\n';
    expect(listTomlTables(toml)).toEqual([
      ['a', 'b'],
      ['c'],
      ['mcp_servers', 'my#srv'],
      ['x', 'y]z'],
    ]);
  });

  it('throws CapabilityFileError on bad escapes and unterminated headers', () => {
    expect(() => listTomlTables('[a."\\U0001F600"]\n')).toThrow(CapabilityFileError);
    expect(() => listTomlTables('[a.b\nk = 1\n')).toThrow(CapabilityFileError);
  });

  it('reads a table key through a quoted header and null when absent', () => {
    const toml = '["skills"]\nenabled = false # why\n';
    expect(readTomlTableKey({ toml, table: 'skills', key: 'enabled' })).toBe('false # why');
    expect(readTomlTableKey({ toml, table: 'skills', key: 'other' })).toBeNull();
    expect(readTomlTableKey({ toml, table: 'nope', key: 'enabled' })).toBeNull();
  });

  it('reads array members, including ] inside a member, and rejects other forms', () => {
    const read = (toml: string) => readTomlArrayMembers({ toml, table: 'skills', key: 'disabled' });
    expect(read('["skills"]\ndisabled = ["a]b", "c"]\n')).toEqual(['a]b', 'c']);
    expect(read('[skills]\n')).toEqual([]);
    expect(() => read('[skills]\ndisabled = [\n"a",\n]\n')).toThrow(CapabilityFileError);
    expect(() => read('[skills]\ndisabled = ["\\U0001F600"]\n')).toThrow(CapabilityFileError);
  });
});

describe('setTomlSkillConfig', () => {
  it('throws a CapabilityFileError for an invalid escape in a skill name', () => {
    const bad = '[[skills.config]]\nname = "\\e"\nenabled = false\n';
    expect(() => setTomlSkillConfig({ toml: bad, name: 'a', enabled: false })).toThrow(
      CapabilityFileError,
    );
  });

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

describe('serialize', () => {
  it('[RF-5] runs same-key tasks one after another', async () => {
    const file = join(dir, 'counter');
    await writeFile(file, '0');
    const bump = async (): Promise<void> => {
      const value = Number(await readFile(file, 'utf8'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      await writeFile(file, String(value + 1));
    };
    await Promise.all([serialize('k', bump), serialize('k', bump)]);
    expect(await readFile(file, 'utf8')).toBe('2');
  });

  it('keeps running after a failed task', async () => {
    const failed = serialize('f', () => Promise.reject(new Error('x')));
    const ok = serialize('f', () => Promise.resolve(7));
    await expect(failed).rejects.toThrow('x');
    await expect(ok).resolves.toBe(7);
  });
});
