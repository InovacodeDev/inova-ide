import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createCheckpoint,
  removeSessionCheckpoints,
  restoreCheckpoint,
} from './git-checkpoints.js';

const exec = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

async function initRepo(): Promise<string> {
  const repo = await makeTempDir('inova-cp-repo-');
  await exec('git', ['init', '-b', 'main'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@inova.dev'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: repo });
  await writeFile(join(repo, '.gitignore'), 'ignored.log\n');
  await writeFile(join(repo, 'tracked.txt'), 'v1\n');
  await exec('git', ['add', '.gitignore', 'tracked.txt'], { cwd: repo });
  await exec('git', ['commit', '-m', 'init'], { cwd: repo });
  return repo;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('git-checkpoints', () => {
  test('returns null outside git repositories', async () => {
    const plain = await makeTempDir('inova-cp-plain-');
    expect(await createCheckpoint({ repoPath: plain, sessionId: 's1', turnId: 't1' })).toBeNull();
  });

  test('captures snapshot without altering git status and restores while preserving .gitignore and skipped large files', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'tracked.txt'), 'v2\n');
    await writeFile(join(repo, 'ignored.log'), 'keep-me\n');
    await writeFile(join(repo, 'huge.bin'), '0123456789ABCDEF');

    const { stdout: statusBefore } = await exec('git', ['status', '--porcelain'], { cwd: repo });
    const cp = await createCheckpoint({
      repoPath: repo,
      sessionId: 'sess-1',
      turnId: 'turn-1',
      maxFileBytes: 10,
      now: () => new Date('2026-11-13T10:00:00.000Z'),
    });
    const { stdout: statusAfter } = await exec('git', ['status', '--porcelain'], { cwd: repo });

    expect(statusAfter).toBe(statusBefore);
    expect(cp).toEqual({
      turnId: 'turn-1',
      ref: 'refs/inova/checkpoints/sess-1/turn-1',
      createdAt: '2026-11-13T10:00:00.000Z',
      skippedLargeFiles: ['huge.bin'],
    });

    await writeFile(join(repo, 'tracked.txt'), 'v3-bad\n');
    await writeFile(join(repo, 'created-later.txt'), 'delete me\n');

    await restoreCheckpoint({
      repoPath: repo,
      ref: cp!.ref,
      preserveFiles: cp!.skippedLargeFiles,
    });

    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('v2\n');
    expect(await readFile(join(repo, 'ignored.log'), 'utf8')).toBe('keep-me\n');
    expect(existsSync(join(repo, 'huge.bin'))).toBe(true);
    expect(existsSync(join(repo, 'created-later.txt'))).toBe(false);

    await removeSessionCheckpoints({ repoPath: repo, sessionId: 'sess-1' });
    const { stdout: refs } = await exec('git', ['for-each-ref', 'refs/inova/checkpoints/sess-1/'], {
      cwd: repo,
    });
    expect(refs.trim()).toBe('');
  });
});
