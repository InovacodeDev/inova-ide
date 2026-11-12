import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import type { LaunchSpec } from './core/launch.js';
import type { CommandRunner } from './core/providers.js';
import { main } from './main.js';
import type { CliIO } from './main.js';

export interface Harness {
  io: CliIO;
  out: string[];
  err: string[];
  spawned: LaunchSpec[];
  spawnResult: { value: number | 'not-found' };
}

export function makeHarness(runner?: CommandRunner): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const spawned: LaunchSpec[] = [];
  const spawnResult: { value: number | 'not-found' } = { value: 0 };
  const io: CliIO = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    runner: runner ?? { run: async () => ({ exitCode: 0, stdout: '' }) },
    spawnInteractive: async (spec) => {
      spawned.push(spec);
      return spawnResult.value;
    },
  };
  return { io, out, err, spawned, spawnResult };
}

export function useTmpRoot(): {
  root: () => string;
  env: () => NodeJS.ProcessEnv;
  setEnv: (extra: NodeJS.ProcessEnv) => void;
  run: (h: Harness, argv: string[]) => Promise<number>;
} {
  let root = '';
  let env: NodeJS.ProcessEnv = {};
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'inova-cli-')));
    env = { INOVA_HOME: root };
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return {
    root: () => root,
    env: () => env,
    setEnv: (extra) => {
      env = { ...env, ...extra };
    },
    run: (h, argv) => main({ argv, env, cwd: root, io: h.io }),
  };
}
