import { buildFilteredSnapshotTree, runGit, tryRunGit } from './git-exec.js';
import {
  WorktreeError,
  applyWorktreeToProject,
  createSessionWorktree,
  removeSessionWorktree,
} from './git-worktree.js';
import type { SessionWorktree } from './types.js';

export interface ComparisonFileDiff {
  path: string;
  leftDiff: string;
  rightDiff: string;
  leftChanged: boolean;
  rightChanged: boolean;
}

export interface ComparisonSideSummary {
  sessionId: string;
  branch: string;
  changedFiles: string[];
  diffStat: string;
}

export interface ComparisonDiffView {
  groupId: string;
  files: ComparisonFileDiff[];
  left: ComparisonSideSummary;
  right: ComparisonSideSummary;
}

export async function createComparisonWorktrees(input: {
  root: string;
  projectId: string;
  projectPath: string;
  groupId: string;
  leftSessionId: string;
  rightSessionId: string;
  now?: () => Date;
}): Promise<{ baseCommit: string; left: SessionWorktree; right: SessionWorktree }> {
  const shortGroup = input.groupId.slice(0, 8);
  const head = await tryRunGit({
    cwd: input.projectPath,
    args: ['rev-parse', '--verify', 'HEAD'],
  });
  if (!head.ok) {
    throw new WorktreeError(
      'no-commits',
      'O repositório precisa de pelo menos um commit para comparar worktrees.',
    );
  }
  const baseCommit = head.stdout.trim();
  const left = await createSessionWorktree({
    root: input.root,
    projectId: input.projectId,
    sessionId: input.leftSessionId,
    projectPath: input.projectPath,
    baseCommit,
    branch: `inova/cmp-${shortGroup}-a`,
    ...(input.now ? { now: input.now } : {}),
  });

  try {
    const right = await createSessionWorktree({
      root: input.root,
      projectId: input.projectId,
      sessionId: input.rightSessionId,
      projectPath: input.projectPath,
      baseCommit,
      branch: `inova/cmp-${shortGroup}-b`,
      ...(input.now ? { now: input.now } : {}),
    });
    return { baseCommit, left, right };
  } catch (error: unknown) {
    await removeSessionWorktree({
      projectPath: input.projectPath,
      worktree: left,
      force: true,
    }).catch(() => undefined);
    throw error;
  }
}

async function collectSideSnapshot(input: { worktree: SessionWorktree }): Promise<{
  tree: string;
  changedFiles: string[];
  diffStat: string;
}> {
  const snapshot = await buildFilteredSnapshotTree({
    repoPath: input.worktree.path,
    baseTreeRef: 'HEAD',
  });
  const namesRes = await runGit({
    cwd: input.worktree.path,
    args: ['diff', '--name-only', input.worktree.baseCommit, snapshot.tree],
  });
  const statRes = await runGit({
    cwd: input.worktree.path,
    args: ['diff', '--stat', input.worktree.baseCommit, snapshot.tree],
  });
  const changedFiles = namesRes.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return {
    tree: snapshot.tree,
    changedFiles,
    diffStat: statRes.stdout.trim(),
  };
}

async function readFileDiff(input: {
  worktreePath: string;
  baseCommit: string;
  tree: string;
  filePath: string;
}): Promise<string> {
  const diffRes = await runGit({
    cwd: input.worktreePath,
    args: ['diff', '--no-color', '-U3', input.baseCommit, input.tree, '--', input.filePath],
  });
  return diffRes.stdout;
}

export async function getComparisonDiff(input: {
  groupId: string;
  leftSessionId: string;
  leftWorktree: SessionWorktree;
  rightSessionId: string;
  rightWorktree: SessionWorktree;
}): Promise<ComparisonDiffView> {
  const [leftSnap, rightSnap] = await Promise.all([
    collectSideSnapshot({ worktree: input.leftWorktree }),
    collectSideSnapshot({ worktree: input.rightWorktree }),
  ]);

  const leftSet = new Set(leftSnap.changedFiles);
  const rightSet = new Set(rightSnap.changedFiles);
  const allPaths = [...new Set([...leftSnap.changedFiles, ...rightSnap.changedFiles])].sort();

  const files: ComparisonFileDiff[] = await Promise.all(
    allPaths.map(async (path) => {
      const leftChanged = leftSet.has(path);
      const rightChanged = rightSet.has(path);
      const [leftDiff, rightDiff] = await Promise.all([
        leftChanged
          ? readFileDiff({
              worktreePath: input.leftWorktree.path,
              baseCommit: input.leftWorktree.baseCommit,
              tree: leftSnap.tree,
              filePath: path,
            })
          : Promise.resolve(''),
        rightChanged
          ? readFileDiff({
              worktreePath: input.rightWorktree.path,
              baseCommit: input.rightWorktree.baseCommit,
              tree: rightSnap.tree,
              filePath: path,
            })
          : Promise.resolve(''),
      ]);
      return { path, leftDiff, rightDiff, leftChanged, rightChanged };
    }),
  );

  return {
    groupId: input.groupId,
    files,
    left: {
      sessionId: input.leftSessionId,
      branch: input.leftWorktree.branch,
      changedFiles: leftSnap.changedFiles,
      diffStat: leftSnap.diffStat,
    },
    right: {
      sessionId: input.rightSessionId,
      branch: input.rightWorktree.branch,
      changedFiles: rightSnap.changedFiles,
      diffStat: rightSnap.diffStat,
    },
  };
}

export async function applyComparisonWinner(input: {
  projectPath: string;
  winnerWorktree: SessionWorktree;
  loserWorktree: SessionWorktree | null;
  cleanupWorktrees: boolean;
}): Promise<{ appliedFiles: string[] }> {
  const applied = await applyWorktreeToProject({
    projectPath: input.projectPath,
    worktreePath: input.winnerWorktree.path,
    baseCommit: input.winnerWorktree.baseCommit,
  });

  if (input.cleanupWorktrees) {
    await removeSessionWorktree({
      projectPath: input.projectPath,
      worktree: input.winnerWorktree,
      force: true,
    });
    if (input.loserWorktree) {
      await removeSessionWorktree({
        projectPath: input.projectPath,
        worktree: input.loserWorktree,
        force: true,
      });
    }
  }

  return applied;
}
