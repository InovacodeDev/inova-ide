import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MAX_GIT_SNAPSHOT_FILE_BYTES = 10 * 1024 * 1024;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

export interface GitRunResult {
  stdout: string;
  stderr: string;
}

export async function runGit(input: {
  cwd: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
}): Promise<GitRunResult> {
  return execFileAsync('git', [...input.args], {
    cwd: input.cwd,
    env: input.env ?? process.env,
    maxBuffer: GIT_MAX_BUFFER,
  });
}

export async function tryRunGit(input: {
  cwd: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
}): Promise<{ ok: true; stdout: string; stderr: string } | { ok: false; message: string }> {
  try {
    const res = await runGit(input);
    return { ok: true, stdout: res.stdout, stderr: res.stderr };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
}

export async function gitRunWithStdin(input: {
  cwd: string;
  args: readonly string[];
  stdin: Buffer;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...input.args], {
      cwd: input.cwd,
      env: input.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out).toString('utf8'));
      } else {
        reject(new Error(Buffer.concat(err).toString('utf8').trim() || `git exit ${String(code)}`));
      }
    });
    child.stdin.end(input.stdin);
  });
}

export async function withTempIndex<T>(work: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const indexPath = join(tmpdir(), `inova-idx-${randomUUID()}`);
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: indexPath };
  try {
    return await work(env);
  } finally {
    await rm(indexPath, { force: true });
  }
}

export async function buildFilteredSnapshotTree(input: {
  repoPath: string;
  baseTreeRef: string | null;
  maxFileBytes?: number;
}): Promise<{ tree: string; trackedInSnapshot: string[]; skippedLargeFiles: string[] }> {
  const limit = input.maxFileBytes ?? MAX_GIT_SNAPSHOT_FILE_BYTES;
  return withTempIndex(async (env) => {
    if (input.baseTreeRef !== null) {
      await runGit({ cwd: input.repoPath, args: ['read-tree', input.baseTreeRef], env });
    }
    const [{ stdout: dirtyTrackedBuf }, { stdout: untrackedBuf }] = await Promise.all([
      execFileAsync('git', ['ls-files', '-z', '--modified', '--deleted'], {
        cwd: input.repoPath,
        env,
        encoding: 'buffer',
        maxBuffer: GIT_MAX_BUFFER,
      }),
      execFileAsync('git', ['ls-files', '-z', '--others', '--exclude-standard'], {
        cwd: input.repoPath,
        env,
        encoding: 'buffer',
        maxBuffer: GIT_MAX_BUFFER,
      }),
    ]);

    const parseNul = (buf: Buffer): string[] =>
      buf
        .toString('utf8')
        .split('\0')
        .filter((entry) => entry !== '');

    const included: string[] = [];
    const skippedLargeFiles: string[] = [];

    for (const relPath of [...new Set([...parseNul(dirtyTrackedBuf), ...parseNul(untrackedBuf)])]) {
      const full = join(input.repoPath, relPath);
      try {
        const info = await lstat(full);
        if (info.isDirectory()) continue;
        if (info.isFile() && info.size > limit) {
          skippedLargeFiles.push(relPath);
          continue;
        }
        included.push(relPath);
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          included.push(relPath);
          continue;
        }
        throw error;
      }
    }

    if (included.length > 0) {
      const nulInput = Buffer.from(`${included.join('\0')}\0`, 'utf8');
      await gitRunWithStdin({
        cwd: input.repoPath,
        args: ['update-index', '--add', '--remove', '-z', '--stdin'],
        stdin: nulInput,
        env,
      });
    }

    const { stdout: treeOut } = await runGit({
      cwd: input.repoPath,
      args: ['write-tree'],
      env,
    });
    return {
      tree: treeOut.trim(),
      trackedInSnapshot: included,
      skippedLargeFiles,
    };
  });
}
