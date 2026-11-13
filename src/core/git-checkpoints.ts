import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { buildFilteredSnapshotTree, gitRunWithStdin, runGit, tryRunGit } from './git-exec.js';

const execFileAsync = promisify(execFile);

export const MAX_CHECKPOINT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_CHECKPOINTS_PER_SESSION = 50;

export interface CheckpointSnapshot {
  turnId: string;
  ref: string;
  createdAt: string;
  skippedLargeFiles: string[];
}

export async function createCheckpoint(input: {
  repoPath: string;
  sessionId: string;
  turnId: string;
  maxFileBytes?: number;
  maxRetention?: number;
  now?: () => Date;
}): Promise<CheckpointSnapshot | null> {
  const inside = await tryRunGit({
    cwd: input.repoPath,
    args: ['rev-parse', '--is-inside-work-tree'],
  });
  if (!inside.ok || inside.stdout.trim() !== 'true') return null;

  const head = await tryRunGit({
    cwd: input.repoPath,
    args: ['rev-parse', '--verify', 'HEAD'],
  });
  const headCommit = head.ok ? head.stdout.trim() : null;

  const snapshot = await buildFilteredSnapshotTree({
    repoPath: input.repoPath,
    baseTreeRef: headCommit,
    maxFileBytes: input.maxFileBytes ?? MAX_CHECKPOINT_FILE_BYTES,
  });

  const commitArgs = [
    'commit-tree',
    snapshot.tree,
    ...(headCommit ? ['-p', headCommit] : []),
    '-m',
    `inova checkpoint ${input.sessionId}/${input.turnId}`,
  ];
  const commitOut = await gitRunWithStdin({
    cwd: input.repoPath,
    args: commitArgs,
    stdin: Buffer.alloc(0),
  });
  const commitHash = commitOut.trim();
  const ref = `refs/inova/checkpoints/${input.sessionId}/${input.turnId}`;
  await runGit({ cwd: input.repoPath, args: ['update-ref', ref, commitHash] });

  const retention = input.maxRetention ?? MAX_CHECKPOINTS_PER_SESSION;
  await pruneCheckpoints({ repoPath: input.repoPath, sessionId: input.sessionId, keep: retention });

  return {
    turnId: input.turnId,
    ref,
    createdAt: (input.now?.() ?? new Date()).toISOString(),
    skippedLargeFiles: snapshot.skippedLargeFiles,
  };
}

async function pruneCheckpoints(input: {
  repoPath: string;
  sessionId: string;
  keep: number;
}): Promise<void> {
  const prefix = `refs/inova/checkpoints/${input.sessionId}/`;
  const listed = await tryRunGit({
    cwd: input.repoPath,
    args: ['for-each-ref', '--sort=creatordate', '--format=%(refname)', prefix],
  });
  if (!listed.ok) return;
  const refs = listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (refs.length <= input.keep) return;
  const drop = refs.slice(0, refs.length - input.keep);
  for (const ref of drop) {
    await tryRunGit({ cwd: input.repoPath, args: ['update-ref', '-d', ref] });
  }
}

export async function restoreCheckpoint(input: {
  repoPath: string;
  ref: string;
  preserveFiles?: readonly string[];
}): Promise<void> {
  await runGit({ cwd: input.repoPath, args: ['rev-parse', '--verify', input.ref] });

  const [
    { stdout: treeBuf },
    { stdout: trackedBuf },
    { stdout: untrackedBuf },
    { stdout: gitDirRaw },
  ] = await Promise.all([
    execFileAsync('git', ['ls-tree', '-r', '-z', '--name-only', input.ref], {
      cwd: input.repoPath,
      encoding: 'buffer',
    }),
    execFileAsync('git', ['ls-files', '-z'], {
      cwd: input.repoPath,
      encoding: 'buffer',
    }),
    execFileAsync('git', ['ls-files', '-z', '--others', '--exclude-standard'], {
      cwd: input.repoPath,
      encoding: 'buffer',
    }),
    execFileAsync('git', ['rev-parse', '--git-dir'], {
      cwd: input.repoPath,
      encoding: 'utf8',
    }),
  ]);

  const targetFiles = new Set(
    treeBuf
      .toString('utf8')
      .split('\0')
      .filter((entry) => entry !== ''),
  );
  const preserve = new Set(input.preserveFiles ?? []);

  const existingFiles = new Set([
    ...trackedBuf
      .toString('utf8')
      .split('\0')
      .filter((entry) => entry !== ''),
    ...untrackedBuf
      .toString('utf8')
      .split('\0')
      .filter((entry) => entry !== ''),
  ]);

  for (const relPath of existingFiles) {
    if (targetFiles.has(relPath) || preserve.has(relPath)) continue;
    await rm(join(input.repoPath, relPath), { force: true });
  }

  const gitDir = resolve(input.repoPath, gitDirRaw.trim());
  const tempIndex = join(tmpdir(), `inova-cp-index-${randomUUID()}`);
  const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
  try {
    await execFileAsync('git', ['--git-dir', gitDir, 'read-tree', input.ref], {
      cwd: input.repoPath,
      env,
    });
    if (targetFiles.size > 0) {
      await execFileAsync(
        'git',
        ['--git-dir', gitDir, '--work-tree', input.repoPath, 'checkout-index', '-a', '-f'],
        {
          cwd: input.repoPath,
          env,
        },
      );
    }
  } finally {
    await rm(tempIndex, { force: true });
  }
}

export async function removeSessionCheckpoints(input: {
  repoPath: string;
  sessionId: string;
}): Promise<void> {
  const prefix = `refs/inova/checkpoints/${input.sessionId}/`;
  const listed = await tryRunGit({
    cwd: input.repoPath,
    args: ['for-each-ref', '--format=%(refname)', prefix],
  });
  if (!listed.ok) return;
  const refs = listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  for (const ref of refs) {
    await tryRunGit({ cwd: input.repoPath, args: ['update-ref', '-d', ref] });
  }
}
