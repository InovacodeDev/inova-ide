import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:os';
import type { LaunchSpec } from './core/launch.js';
import type { CommandRunner } from './core/providers.js';
import type { CliIO } from './main.js';

function errorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

export const nodeRunner: CommandRunner = {
  run: (cmd) =>
    new Promise((resolve, reject) => {
      execFile(cmd.command, cmd.args, { env: cmd.env, encoding: 'utf8' }, (error, stdout) => {
        if (error === null) return resolve({ exitCode: 0, stdout });
        const code = errorCode(error);
        if (code === 'ENOENT') return resolve({ notFound: true });
        if (typeof code === 'number') return resolve({ exitCode: code, stdout });
        return reject(error);
      });
    }),
};

function spawnInteractive(spec: LaunchSpec): Promise<number | 'not-found'> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: 'inherit',
    });
    child.on('error', (error) => {
      if (errorCode(error) === 'ENOENT') return resolve('not-found');
      return reject(error);
    });
    child.on('close', (code, signal) => {
      if (code !== null) return resolve(code);
      resolve(signal === null ? 1 : 128 + (constants.signals[signal] ?? 0));
    });
  });
}

export const nodeIO: CliIO = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  runner: nodeRunner,
  spawnInteractive,
};
