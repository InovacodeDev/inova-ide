import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { gitRunWithStdin } from './git-exec.js';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'inova-git-exec-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

it('resolves with the exit result when git exits before reading all of stdin', async () => {
  const stdin = Buffer.alloc(16 * 1024 * 1024, 'a');
  const output = await gitRunWithStdin({ cwd, args: ['--version'], stdin });
  expect(output).toMatch(/^git version/);
});

it('rejects with the git error when git fails before reading stdin', async () => {
  const stdin = Buffer.alloc(16 * 1024 * 1024, 'a');
  await expect(gitRunWithStdin({ cwd, args: ['not-a-real-git-command'], stdin })).rejects.toThrow(
    /not-a-real-git-command/,
  );
});
