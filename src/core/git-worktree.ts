import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildFilteredSnapshotTree, gitRunWithStdin, runGit, tryRunGit } from './git-exec.js';
import type { SessionWorktree } from './types.js';

type WorktreeErrorCode =
  'not-git-repo' | 'no-commits' | 'dirty-main' | 'dirty-worktree' | 'conflict' | 'git-failed';

export class WorktreeError extends Error {
  readonly code: WorktreeErrorCode;

  constructor(code: WorktreeErrorCode, message: string) {
    super(message);
    this.name = 'WorktreeError';
    this.code = code;
  }
}

export async function createSessionWorktree(input: {
  root: string;
  projectId: string;
  sessionId: string;
  projectPath: string;
  baseCommit?: string;
  branch?: string;
  now?: () => Date;
}): Promise<SessionWorktree> {
  const inside = await tryRunGit({
    cwd: input.projectPath,
    args: ['rev-parse', '--is-inside-work-tree'],
  });
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    throw new WorktreeError('not-git-repo', 'O projeto não é um repositório Git.');
  }

  let baseCommit = input.baseCommit;
  if (!baseCommit) {
    const head = await tryRunGit({
      cwd: input.projectPath,
      args: ['rev-parse', '--verify', 'HEAD'],
    });
    if (!head.ok) {
      throw new WorktreeError(
        'no-commits',
        'O repositório precisa de pelo menos um commit para criar um worktree.',
      );
    }
    baseCommit = head.stdout.trim();
  }

  const branch = input.branch ?? `inova/s-${input.sessionId.slice(0, 8)}`;
  const worktreeDir = join(input.root, 'worktrees', input.projectId, input.sessionId);
  await mkdir(join(input.root, 'worktrees', input.projectId), { recursive: true });

  const added = await tryRunGit({
    cwd: input.projectPath,
    args: ['worktree', 'add', '-b', branch, worktreeDir, baseCommit],
  });
  if (!added.ok) {
    throw new WorktreeError('git-failed', `Falha ao criar worktree: ${added.message}`);
  }

  return {
    path: worktreeDir,
    branch,
    baseCommit,
    createdAt: (input.now?.() ?? new Date()).toISOString(),
  };
}

export interface WorktreeStatus {
  branch: string;
  changedFiles: string[];
  diffStat: string;
  diff: string;
  dirty: boolean;
}

export async function getWorktreeStatus(input: {
  worktreePath: string;
  baseCommit: string;
}): Promise<WorktreeStatus> {
  const branchRes = await tryRunGit({
    cwd: input.worktreePath,
    args: ['rev-parse', '--abbrev-ref', 'HEAD'],
  });
  const branch = branchRes.ok ? branchRes.stdout.trim() : '';

  const snapshot = await buildFilteredSnapshotTree({
    repoPath: input.worktreePath,
    baseTreeRef: 'HEAD',
  });
  const namesRes = await runGit({
    cwd: input.worktreePath,
    args: ['diff', '--name-only', input.baseCommit, snapshot.tree],
  });
  const changedFiles = namesRes.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const statRes = await runGit({
    cwd: input.worktreePath,
    args: ['diff', '--stat', input.baseCommit, snapshot.tree],
  });
  const diffRes = await runGit({
    cwd: input.worktreePath,
    args: ['diff', '--binary', input.baseCommit, snapshot.tree],
  });
  const dirtyRes = await runGit({
    cwd: input.worktreePath,
    args: ['status', '--porcelain'],
  });

  return {
    branch,
    changedFiles,
    diffStat: statRes.stdout.trim(),
    diff: diffRes.stdout,
    dirty: dirtyRes.stdout.trim() !== '' || changedFiles.length > 0,
  };
}

export async function applyWorktreeToProject(input: {
  projectPath: string;
  worktreePath: string;
  baseCommit: string;
}): Promise<{ appliedFiles: string[] }> {
  const mainDirty = await runGit({ cwd: input.projectPath, args: ['status', '--porcelain'] });
  if (mainDirty.stdout.trim() !== '') {
    throw new WorktreeError(
      'dirty-main',
      'O repositório principal possui alterações não commitadas.',
    );
  }

  const status = await getWorktreeStatus({
    worktreePath: input.worktreePath,
    baseCommit: input.baseCommit,
  });
  if (status.diff.trim() === '') {
    return { appliedFiles: [] };
  }

  const patch = Buffer.from(status.diff, 'utf8');
  try {
    await gitRunWithStdin({
      cwd: input.projectPath,
      args: ['apply', '--check', '-'],
      stdin: patch,
    });
    await gitRunWithStdin({
      cwd: input.projectPath,
      args: ['apply', '-'],
      stdin: patch,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorktreeError(
      'conflict',
      `Conflito ao aplicar alterações do worktree na branch principal: ${message}`,
    );
  }

  return { appliedFiles: status.changedFiles };
}

export async function removeSessionWorktree(input: {
  projectPath: string;
  worktree: SessionWorktree;
  force: boolean;
}): Promise<void> {
  if (!input.force) {
    const status = await tryRunGit({
      cwd: input.worktree.path,
      args: ['status', '--porcelain'],
    });
    if (status.ok && status.stdout.trim() !== '') {
      throw new WorktreeError(
        'dirty-worktree',
        'O worktree possui alterações não aplicadas. Confirme a remoção.',
      );
    }
  }

  await tryRunGit({
    cwd: input.projectPath,
    args: ['worktree', 'remove', '--force', input.worktree.path],
  });
  await rm(input.worktree.path, { recursive: true, force: true });
  await tryRunGit({ cwd: input.projectPath, args: ['worktree', 'prune'] });
  await tryRunGit({
    cwd: input.projectPath,
    args: ['branch', '-D', input.worktree.branch],
  });
}
