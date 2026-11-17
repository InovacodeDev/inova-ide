import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hashSkillDir,
  importSkillFolder,
  installSkillFromText,
  SkillValidationError,
} from './skills.js';
import { skillDir } from './store.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let root: string;
let scratch: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inova-skills-root-'));
  scratch = await mkdtemp(join(tmpdir(), 'inova-skills-src-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

function skillText(label: string, extra = ''): string {
  return `---\nname: ${label}\ndescription: Skill ${label}\n---\n\nBody ${label}\n${extra}`;
}

async function writeTree(dir: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = join(dir, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

async function source(files: Record<string, string>): Promise<string> {
  const dir = join(scratch, `src-${Math.random().toString(16).slice(2)}`);
  await writeTree(dir, files);
  return dir;
}

async function skillsRootEntries(): Promise<string[]> {
  try {
    return await readdir(join(root, 'library', 'skills'));
  } catch {
    return [];
  }
}

async function backupsOf(id: string): Promise<string[]> {
  const parent = join(root, 'backups', 'library');
  const stamps = await readdir(parent);
  return stamps.map((stamp) => join(parent, stamp, 'skills', id));
}

describe('skill id validation', () => {
  it.each(['../x', 'A', '', 'a/b', 'a b', '-a'])('rejects the id %j', async (id) => {
    await expect(
      installSkillFromText({ root, id, content: skillText('x') }),
    ).rejects.toBeInstanceOf(SkillValidationError);
    expect(await skillsRootEntries()).toEqual([]);
  });

  it('rejects an id on folder import before reading the source', async () => {
    await expect(
      importSkillFolder({ root, id: '../x', sourceDir: join(scratch, 'missing') }),
    ).rejects.toBeInstanceOf(SkillValidationError);
  });
});

describe('SKILL.md validation', () => {
  it.each([
    ['no front matter', 'just a body\n'],
    ['unclosed front matter', '---\nname: a\ndescription: b\n'],
    ['no name', '---\ndescription: b\n---\nbody\n'],
    ['no description', '---\nname: a\n---\nbody\n'],
    ['empty name', '---\nname: ""\ndescription: b\n---\nbody\n'],
    ['blank description', '---\nname: a\ndescription:    \n---\nbody\n'],
    ['oversized file', skillText('big', 'x'.repeat(256 * 1024))],
    ['Bearer token', skillText('tok', 'Authorization: Bearer abc123\n')],
    ['uppercase assignment secret', skillText('env', 'API_KEY="abc123"\n')],
    ['api key token', skillText('key', 'use sk-abcdefghijklmnopqrstuvwxyz123456\n')],
  ])('rejects %s and leaves nothing behind', async (_label, content) => {
    await expect(installSkillFromText({ root, id: 'bad', content })).rejects.toBeInstanceOf(
      SkillValidationError,
    );
    expect(await skillsRootEntries()).toEqual([]);
  });

  it('accepts CRLF, quoted values and a leading BOM', async () => {
    const content =
      '﻿---\r\nname: "Quoted name"\r\ndescription: \'Single quoted\'\r\n---\r\nbody\r\n';
    const { hash } = await installSkillFromText({ root, id: 'quoted', content });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(join(skillDir(root, 'quoted'), 'SKILL.md'), 'utf8')).toBe(content);
  });

  it('rejects a SKILL.md with a secret during folder import too', async () => {
    const sourceDir = await source({ 'SKILL.md': skillText('s', 'Bearer abc123\n') });
    await expect(importSkillFolder({ root, id: 's', sourceDir })).rejects.toThrow(/secrets/);
    expect(await skillsRootEntries()).toEqual([]);
  });
});

describe('folder import', () => {
  it('copies nested files and ignores .git, node_modules and the marker', async () => {
    const sourceDir = await source({
      'SKILL.md': skillText('full'),
      'scripts/run.sh': '#!/bin/sh\necho hi\n',
      'refs/deep/note.txt': 'note',
      '.git/config': 'git',
      'node_modules/pkg/index.js': 'js',
      '.inova-managed': '{"managedBy":"inova-ide"}',
    });
    await importSkillFolder({ root, id: 'full', sourceDir });
    const target = skillDir(root, 'full');
    expect((await readdir(target)).sort()).toEqual(['SKILL.md', 'refs', 'scripts']);
    expect(await readFile(join(target, 'refs', 'deep', 'note.txt'), 'utf8')).toBe('note');
  });

  it('preserves only the owner execute bit', async () => {
    if (process.platform === 'win32') return;
    const sourceDir = await source({ 'SKILL.md': skillText('exec'), 'run.sh': '#!/bin/sh\n' });
    await chmod(join(sourceDir, 'run.sh'), 0o777);
    await importSkillFolder({ root, id: 'exec', sourceDir });
    const mode = (await stat(join(skillDir(root, 'exec'), 'run.sh'))).mode & 0o777;
    expect(mode).toBe(0o700);
    const plain = (await stat(join(skillDir(root, 'exec'), 'SKILL.md'))).mode & 0o777;
    expect(plain).toBe(0o600);
  });

  it('rejects the whole import when the tree has a symbolic link', async () => {
    const sourceDir = await source({ 'SKILL.md': skillText('link'), 'real.txt': 'x' });
    try {
      await symlink(join(sourceDir, 'real.txt'), join(sourceDir, 'alias.txt'), 'file');
    } catch {
      return;
    }
    await expect(importSkillFolder({ root, id: 'link', sourceDir })).rejects.toThrow(/symbolic/);
    expect(await skillsRootEntries()).toEqual([]);
  });

  it('rejects a symbolic link to a folder without following it', async () => {
    const outside = await source({ 'secret.txt': 'outside' });
    const sourceDir = await source({ 'SKILL.md': skillText('dirlink') });
    try {
      await symlink(outside, join(sourceDir, 'out'), 'junction');
    } catch {
      return;
    }
    await expect(importSkillFolder({ root, id: 'dirlink', sourceDir })).rejects.toThrow(/symbolic/);
    expect(await skillsRootEntries()).toEqual([]);
  });

  it('rejects a source folder that is itself a symbolic link', async () => {
    const real = await source({ 'SKILL.md': skillText('rootlink') });
    const alias = join(scratch, 'alias-dir');
    try {
      await symlink(real, alias, 'junction');
    } catch {
      return;
    }
    await expect(importSkillFolder({ root, id: 'rootlink', sourceDir: alias })).rejects.toThrow(
      SkillValidationError,
    );
  });

  it.each(['.env', '.env.local', '.envrc'])(
    'rejects an environment file named %s',
    async (name) => {
      const sourceDir = await source({ 'SKILL.md': skillText('env'), [name]: 'TOKEN=abc' });
      await expect(importSkillFolder({ root, id: 'env', sourceDir })).rejects.toThrow(name);
      expect(await skillsRootEntries()).toEqual([]);
    },
  );

  it('rejects an environment file in a subfolder', async () => {
    const sourceDir = await source({ 'SKILL.md': skillText('env'), 'sub/.env': 'TOKEN=abc' });
    await expect(importSkillFolder({ root, id: 'env', sourceDir })).rejects.toThrow(/\.env/);
  });

  it('rejects more than 200 files', async () => {
    const files: Record<string, string> = { 'SKILL.md': skillText('many') };
    for (let index = 0; index < 200; index += 1) files[`f/${index}.txt`] = 'x';
    const sourceDir = await source(files);
    await expect(importSkillFolder({ root, id: 'many', sourceDir })).rejects.toThrow(/200 files/);
    expect(await skillsRootEntries()).toEqual([]);
  });

  it('accepts exactly 200 files', async () => {
    const files: Record<string, string> = { 'SKILL.md': skillText('edge') };
    for (let index = 0; index < 199; index += 1) files[`f/${index}.txt`] = 'x';
    const sourceDir = await source(files);
    await expect(importSkillFolder({ root, id: 'edge', sourceDir })).resolves.toHaveProperty(
      'hash',
    );
  });

  it('rejects a folder larger than 5 MiB', async () => {
    const sourceDir = await source({ 'SKILL.md': skillText('big') });
    await writeFile(join(sourceDir, 'blob.bin'), Buffer.alloc(5 * 1024 * 1024 + 1));
    await expect(importSkillFolder({ root, id: 'big', sourceDir })).rejects.toThrow(/5242880/);
    expect(await skillsRootEntries()).toEqual([]);
  });

  it('rejects nesting deeper than 5 levels and accepts exactly 5', async () => {
    const tooDeep = await source({ 'SKILL.md': skillText('deep'), 'a/b/c/d/e/f/x.txt': 'x' });
    await expect(importSkillFolder({ root, id: 'deep', sourceDir: tooDeep })).rejects.toThrow(
      /nesting/,
    );
    const allowed = await source({ 'SKILL.md': skillText('deep'), 'a/b/c/d/e/x.txt': 'x' });
    await expect(importSkillFolder({ root, id: 'deep', sourceDir: allowed })).resolves.toBeTruthy();
  });

  it('rejects a folder without SKILL.md at the root', async () => {
    const sourceDir = await source({ 'nested/SKILL.md': skillText('nested') });
    await expect(importSkillFolder({ root, id: 'nested', sourceDir })).rejects.toThrow(/SKILL\.md/);
    expect(await skillsRootEntries()).toEqual([]);
  });

  it('rejects a missing source folder', async () => {
    await expect(
      importSkillFolder({ root, id: 'gone', sourceDir: join(scratch, 'nope') }),
    ).rejects.toThrow();
    expect(await skillsRootEntries()).toEqual([]);
  });
});

describe('skill hash', () => {
  it('is a stable sha256 and equals the hash returned by the install', async () => {
    const sourceDir = await source({ 'SKILL.md': skillText('h'), 'a/b.txt': 'b', 'a.txt': 'a' });
    const { hash } = await importSkillFolder({ root, id: 'h', sourceDir });
    const target = skillDir(root, 'h');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashSkillDir(target)).toBe(hash);
    expect(await hashSkillDir(target)).toBe(hash);
    expect(await hashSkillDir(sourceDir)).toBe(hash);
  });

  it('changes when one byte changes or a file is renamed', async () => {
    const dirA = await source({ 'SKILL.md': skillText('h'), 'x.txt': 'aaaa' });
    const dirB = await source({ 'SKILL.md': skillText('h'), 'x.txt': 'aaab' });
    const dirC = await source({ 'SKILL.md': skillText('h'), 'y.txt': 'aaaa' });
    const [a, b, c] = [
      await hashSkillDir(dirA),
      await hashSkillDir(dirB),
      await hashSkillDir(dirC),
    ];
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('does not confuse a file boundary with file content', async () => {
    const dirA = await source({ 'SKILL.md': skillText('h'), a: 'bc', b: '' });
    const dirB = await source({ 'SKILL.md': skillText('h'), a: 'b', b: 'c' });
    expect(await hashSkillDir(dirA)).not.toBe(await hashSkillDir(dirB));
  });

  it('ignores the marker file and environment files', async () => {
    const dir = await source({ 'SKILL.md': skillText('h') });
    const before = await hashSkillDir(dir);
    await writeFile(join(dir, '.inova-managed'), '{"managedBy":"inova-ide"}');
    await writeFile(join(dir, '.env'), 'TOKEN=abc');
    expect(await hashSkillDir(dir)).toBe(before);
  });
});

describe('atomic replace and backup', () => {
  it('backs up the previous folder when reinstalling', async () => {
    await installSkillFromText({ root, id: 'again', content: skillText('v1') });
    await installSkillFromText({ root, id: 'again', content: skillText('v2') });
    expect(await readFile(join(skillDir(root, 'again'), 'SKILL.md'), 'utf8')).toBe(skillText('v2'));
    const [backup] = await backupsOf('again');
    expect(await readFile(join(backup ?? '', 'SKILL.md'), 'utf8')).toBe(skillText('v1'));
    expect(await skillsRootEntries()).toEqual(['again']);
  });

  it('creates no backup on the first install', async () => {
    await installSkillFromText({ root, id: 'first', content: skillText('v1') });
    await expect(readdir(join(root, 'backups'))).rejects.toThrow();
  });

  it('leaves nothing behind when the first install fails on rename', async () => {
    vi.mocked(rename).mockRejectedValueOnce(new Error('rename failed'));
    await expect(
      installSkillFromText({ root, id: 'fresh', content: skillText('v1') }),
    ).rejects.toThrow('rename failed');
    expect(await skillsRootEntries()).toEqual([]);
    await installSkillFromText({ root, id: 'fresh', content: skillText('v1') });
    expect(await skillsRootEntries()).toEqual(['fresh']);
  });

  it('keeps the previous folder and no temp when the first rename of a reinstall fails', async () => {
    await installSkillFromText({ root, id: 'keep', content: skillText('v1') });
    vi.mocked(rename).mockRejectedValueOnce(new Error('rename failed'));
    await expect(
      installSkillFromText({ root, id: 'keep', content: skillText('v2') }),
    ).rejects.toThrow('rename failed');
    expect(await readFile(join(skillDir(root, 'keep'), 'SKILL.md'), 'utf8')).toBe(skillText('v1'));
    expect(await skillsRootEntries()).toEqual(['keep']);
  });

  it('restores the previous folder when the second rename of a reinstall fails', async () => {
    await installSkillFromText({ root, id: 'undo', content: skillText('v1') });
    const actual = await vi.importActual<typeof FsPromises>('node:fs/promises');
    vi.mocked(rename)
      .mockImplementationOnce(actual.rename)
      .mockRejectedValueOnce(new Error('second rename failed'));
    await expect(
      installSkillFromText({ root, id: 'undo', content: skillText('v2') }),
    ).rejects.toThrow('second rename failed');
    expect(await readFile(join(skillDir(root, 'undo'), 'SKILL.md'), 'utf8')).toBe(skillText('v1'));
    expect(await skillsRootEntries()).toEqual(['undo']);
  });

  it('leaves the previous folder intact when the backup directory cannot be created', async () => {
    await installSkillFromText({ root, id: 'blocked', content: skillText('v1') });
    await writeFile(join(root, 'backups'), 'not a directory');
    await expect(
      installSkillFromText({ root, id: 'blocked', content: skillText('v2') }),
    ).rejects.toThrow();
    expect(await readFile(join(skillDir(root, 'blocked'), 'SKILL.md'), 'utf8')).toBe(
      skillText('v1'),
    );
    expect(await skillsRootEntries()).toEqual(['blocked']);
  });

  it('keeps one consistent folder when two installs of the same id run together', async () => {
    const contents = ['a', 'b', 'c', 'd', 'e'].map((label) => skillText(label, `${label}\n`));
    const results = await Promise.all(
      contents.map((content) => installSkillFromText({ root, id: 'race', content })),
    );
    const final = await readFile(join(skillDir(root, 'race'), 'SKILL.md'), 'utf8');
    expect(contents).toContain(final);
    expect(await hashSkillDir(skillDir(root, 'race'))).toBe(results[contents.indexOf(final)]?.hash);
    expect(await skillsRootEntries()).toEqual(['race']);
  });
});
