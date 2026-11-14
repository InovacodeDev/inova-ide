import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupFile, CapabilityFileError, updateJsonFile } from './file-edit.js';

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
