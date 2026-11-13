import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';
import {
  applyComparisonWinner,
  createComparisonWorktrees,
  getComparisonDiff,
} from './git-compare.js';
import { WorktreeError } from './git-worktree.js';

const exec = promisify(execFile);
const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-compare-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function initRepo(): Promise<string> {
  const repo = await tmp();
  await exec('git', ['init', '-b', 'main'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@inova.dev'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: repo });
  await writeFile(join(repo, 'app.ts'), 'export const value = 1;\n');
  await writeFile(join(repo, 'shared.ts'), 'export const shared = "a";\n');
  await exec('git', ['add', '.'], { cwd: repo });
  await exec('git', ['commit', '-m', 'init'], { cwd: repo });
  return repo;
}

describe('git-compare', () => {
  test('creates two worktrees from identical baseCommit, collects per-file diffs, and applies winner', async () => {
    const root = await tmp();
    const repo = await initRepo();
    const pair = await createComparisonWorktrees({
      root,
      projectId: 'proj-1',
      projectPath: repo,
      groupId: 'cmp12345678',
      leftSessionId: 'sess-left',
      rightSessionId: 'sess-right',
      now: () => new Date('2026-11-13T10:00:00.000Z'),
    });

    expect(pair.left.baseCommit).toBe(pair.baseCommit);
    expect(pair.right.baseCommit).toBe(pair.baseCommit);
    expect(pair.left.branch).toBe('inova/cmp-cmp12345-a');
    expect(pair.right.branch).toBe('inova/cmp-cmp12345-b');

    await writeFile(join(pair.left.path, 'app.ts'), 'export const value = 2;\n');
    await writeFile(join(pair.left.path, 'left-only.ts'), 'export const left = true;\n');
    await writeFile(join(pair.right.path, 'app.ts'), 'export const value = 3;\n');

    const comparison = await getComparisonDiff({
      groupId: 'cmp12345678',
      leftSessionId: 'sess-left',
      leftWorktree: pair.left,
      rightSessionId: 'sess-right',
      rightWorktree: pair.right,
    });

    expect(comparison.left.changedFiles).toEqual(['app.ts', 'left-only.ts']);
    expect(comparison.right.changedFiles).toEqual(['app.ts']);
    const appEntry = comparison.files.find((entry) => entry.path === 'app.ts');
    expect(appEntry?.leftChanged).toBe(true);
    expect(appEntry?.rightChanged).toBe(true);
    expect(appEntry?.leftDiff).toContain('+export const value = 2;');
    expect(appEntry?.rightDiff).toContain('+export const value = 3;');

    const resolved = await applyComparisonWinner({
      projectPath: repo,
      winnerWorktree: pair.left,
      loserWorktree: pair.right,
      cleanupWorktrees: true,
    });

    expect(resolved.appliedFiles).toEqual(['app.ts', 'left-only.ts']);
    expect(await readFile(join(repo, 'app.ts'), 'utf8')).toBe('export const value = 2;\n');
    expect(await readFile(join(repo, 'left-only.ts'), 'utf8')).toBe('export const left = true;\n');
  });

  test('refuses applying winner when main repository has uncommitted changes without destroying worktrees', async () => {
    const root = await tmp();
    const repo = await initRepo();
    const pair = await createComparisonWorktrees({
      root,
      projectId: 'proj-1',
      projectPath: repo,
      groupId: 'cmp99999999',
      leftSessionId: 'sess-left',
      rightSessionId: 'sess-right',
    });

    await writeFile(join(pair.right.path, 'app.ts'), 'export const value = 42;\n');
    await writeFile(join(repo, 'dirty.txt'), 'dirty\n');

    await expect(
      applyComparisonWinner({
        projectPath: repo,
        winnerWorktree: pair.right,
        loserWorktree: pair.left,
        cleanupWorktrees: true,
      }),
    ).rejects.toThrow(WorktreeError);

    expect(await readFile(join(pair.right.path, 'app.ts'), 'utf8')).toBe(
      'export const value = 42;\n',
    );
  });
});
