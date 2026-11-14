import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupFile } from './file-edit.js';

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
