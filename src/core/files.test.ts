import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, test } from 'vitest';
import { listProjectFiles, rankProjectFiles } from './files.js';

const execFileAsync = promisify(execFile);
const tmpDirs: string[] = [];

async function tmpDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-files-')));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('listProjectFiles respects .gitignore and includes untracked non-ignored files in a git repo', async () => {
  const repo = await tmpDir();
  await execFileAsync('git', ['init'], { cwd: repo });
  await writeFile(join(repo, '.gitignore'), 'ignored-dir/\n*.log\n');
  await mkdir(join(repo, 'src', 'core'), { recursive: true });
  await mkdir(join(repo, 'ignored-dir'), { recursive: true });
  await writeFile(join(repo, 'src', 'core', 'app.ts'), 'export const a = 1;\n');
  await writeFile(join(repo, 'README.md'), '# Test\n');
  await writeFile(join(repo, 'ignored-dir', 'secret.txt'), 'skip\n');
  await writeFile(join(repo, 'debug.log'), 'skip\n');
  await execFileAsync('git', ['add', '.gitignore', 'README.md'], { cwd: repo });

  const result = await listProjectFiles({ projectPath: repo });

  expect(result.truncated).toBe(false);
  expect(result.files).toEqual(['.gitignore', 'README.md', 'src/core/app.ts']);
});

test('listProjectFiles falls back to directory walk ignoring .git and node_modules without git', async () => {
  const folder = await tmpDir();
  await mkdir(join(folder, 'src'), { recursive: true });
  await mkdir(join(folder, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(folder, '.git', 'objects'), { recursive: true });
  await writeFile(join(folder, 'src', 'index.ts'), 'export {};\n');
  await writeFile(join(folder, 'node_modules', 'pkg', 'index.js'), '');
  await writeFile(join(folder, '.git', 'objects', 'abc'), '');

  const outside = await tmpDir();
  await writeFile(join(outside, 'leak.txt'), 'outside');
  await symlink(outside, join(folder, 'external-link'));

  const result = await listProjectFiles({ projectPath: folder });

  expect(result.truncated).toBe(false);
  expect(result.files).toEqual(['src/index.ts']);
});

test('listProjectFiles truncates at maxFiles', async () => {
  const folder = await tmpDir();
  await Promise.all(
    Array.from({ length: 6 }, (_, idx) => writeFile(join(folder, `file-${idx}.ts`), '')),
  );

  const result = await listProjectFiles({ projectPath: folder, maxFiles: 3 });

  expect(result.truncated).toBe(true);
  expect(result.files).toHaveLength(3);
});

test('rankProjectFiles prioritizes basename exact, prefix, substring, and fuzzy matches', () => {
  const files = [
    'docs/notes.md',
    'src/components/ChatView.tsx',
    'src/core/chat-types.ts',
    'src/core/chat.ts',
    'apps/desktop/src/main/chat.ts',
  ];

  const exactRanked = rankProjectFiles(files, 'chat.ts', 10);
  expect(exactRanked.slice(0, 2)).toEqual(['src/core/chat.ts', 'apps/desktop/src/main/chat.ts']);
  expect(exactRanked).not.toContain('docs/notes.md');

  expect(rankProjectFiles(files, 'chat', 10)[0]).toBe('src/core/chat.ts');
  expect(rankProjectFiles(files, 'cv', 10)).toContain('src/components/ChatView.tsx');
  expect(rankProjectFiles(files, '', 2)).toEqual([
    'apps/desktop/src/main/chat.ts',
    'docs/notes.md',
  ]);
});
