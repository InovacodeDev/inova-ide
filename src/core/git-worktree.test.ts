import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';
import {
  WorktreeError,
  applyWorktreeToProject,
  createSessionWorktree,
  getWorktreeStatus,
  removeSessionWorktree,
} from './git-worktree.js';

const exec = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

async function initRepo(): Promise<string> {
  const repo = await makeTempDir('inova-wt-repo-');
  await exec('git', ['init', '-b', 'main'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@inova.dev'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: repo });
  await writeFile(join(repo, 'app.txt'), 'hello\n');
  await exec('git', ['add', 'app.txt'], { cwd: repo });
  await exec('git', ['commit', '-m', 'init'], { cwd: repo });
  return repo;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('git-worktree', () => {
  test('rejects non-git folder or repo without commits', async () => {
    const root = await makeTempDir('inova-wt-root-');
    const plain = await makeTempDir('inova-wt-plain-');
    await expect(
      createSessionWorktree({ root, projectId: 'p1', sessionId: 's1-123456', projectPath: plain }),
    ).rejects.toMatchObject({ code: 'not-git-repo' });

    const emptyRepo = await makeTempDir('inova-wt-empty-');
    await exec('git', ['init', '-b', 'main'], { cwd: emptyRepo });
    await expect(
      createSessionWorktree({
        root,
        projectId: 'p1',
        sessionId: 's1-123456',
        projectPath: emptyRepo,
      }),
    ).rejects.toMatchObject({ code: 'no-commits' });
  });

  test('creates an isolated worktree, collects diff including untracked files, applies to main, and removes', async () => {
    const root = await makeTempDir('inova-wt-root-');
    const repo = await initRepo();

    const wt = await createSessionWorktree({
      root,
      projectId: 'proj-1',
      sessionId: 'abcdef12-3456',
      projectPath: repo,
      now: () => new Date('2026-11-13T10:00:00.000Z'),
    });

    expect(wt.branch).toBe('inova/s-abcdef12');
    expect(wt.createdAt).toBe('2026-11-13T10:00:00.000Z');

    await writeFile(join(wt.path, 'app.txt'), 'hello worktree\n');
    await writeFile(join(wt.path, 'new-file.ts'), 'export const x = 1;\n');

    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toBe('hello\n');

    const status = await getWorktreeStatus({
      worktreePath: wt.path,
      baseCommit: wt.baseCommit,
    });
    expect(status.dirty).toBe(true);
    expect(status.changedFiles).toEqual(['app.txt', 'new-file.ts']);
    expect(status.diff).toContain('hello worktree');
    expect(status.diff).toContain('export const x = 1;');

    await expect(
      removeSessionWorktree({ projectPath: repo, worktree: wt, force: false }),
    ).rejects.toBeInstanceOf(WorktreeError);

    const applied = await applyWorktreeToProject({
      projectPath: repo,
      worktreePath: wt.path,
      baseCommit: wt.baseCommit,
    });
    expect(applied.appliedFiles).toEqual(['app.txt', 'new-file.ts']);
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toBe('hello worktree\n');
    expect(await readFile(join(repo, 'new-file.ts'), 'utf8')).toBe('export const x = 1;\n');

    await removeSessionWorktree({ projectPath: repo, worktree: wt, force: true });
    const { stdout: branches } = await exec('git', ['branch', '--list', wt.branch], { cwd: repo });
    expect(branches.trim()).toBe('');
  });

  test('refuses applyWorktreeToProject when main repo has uncommitted changes', async () => {
    const root = await makeTempDir('inova-wt-root-');
    const repo = await initRepo();
    const wt = await createSessionWorktree({
      root,
      projectId: 'proj-1',
      sessionId: 'sess-dirty',
      projectPath: repo,
    });

    await writeFile(join(wt.path, 'app.txt'), 'from wt\n');
    await writeFile(join(repo, 'app.txt'), 'dirty main\n');

    await expect(
      applyWorktreeToProject({
        projectPath: repo,
        worktreePath: wt.path,
        baseCommit: wt.baseCommit,
      }),
    ).rejects.toMatchObject({ code: 'dirty-main' });
  });
});
