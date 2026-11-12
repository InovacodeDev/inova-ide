import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { constants } from 'node:os';
import type { LaunchSpec } from './core/launch.js';
import { RUNNER_ABORTED } from './core/providers.js';
import type { CommandRunner } from './core/providers.js';
import type { CliIO } from './main.js';

function errorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

const RUNNER_TIMEOUT_MS = 10_000;

function wasKilled(error: unknown): boolean {
  return error instanceof Error && 'killed' in error && error.killed === true;
}

function diedBySignal(error: unknown): boolean {
  return error instanceof Error && 'signal' in error && typeof error.signal === 'string';
}

export const nodeRunner: CommandRunner = {
  run: (cmd) =>
    new Promise((resolve, reject) => {
      const options = { env: cmd.env, encoding: 'utf8', timeout: RUNNER_TIMEOUT_MS } as const;
      execFile(cmd.command, cmd.args, options, (error, stdout) => {
        if (error === null) return resolve({ exitCode: 0, stdout });
        const code = errorCode(error);
        if (code === 'ENOENT') return resolve({ notFound: true });
        if (wasKilled(error) || diedBySignal(error))
          return resolve({ exitCode: RUNNER_ABORTED, stdout: '' });
        if (typeof code === 'number') return resolve({ exitCode: code, stdout });
        return reject(error);
      });
    }),
};

const IGNORED_SIGNALS = ['SIGINT', 'SIGQUIT'] as const;
const FORWARDED_SIGNALS = ['SIGTERM', 'SIGHUP'] as const;

function ignoreSignal(): void {
  return undefined;
}

function relaySignals(child: ChildProcess): () => void {
  const forwards = FORWARDED_SIGNALS.map((signal) => ({
    signal,
    handler: () => child.kill(signal),
  }));
  for (const signal of IGNORED_SIGNALS) process.on(signal, ignoreSignal);
  for (const { signal, handler } of forwards) process.on(signal, handler);
  return () => {
    for (const signal of IGNORED_SIGNALS) process.off(signal, ignoreSignal);
    for (const { signal, handler } of forwards) process.off(signal, handler);
  };
}

function spawnInteractive(spec: LaunchSpec): Promise<number | 'not-found'> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: 'inherit',
    });
    const release = relaySignals(child);
    child.on('error', (error) => {
      release();
      if (errorCode(error) === 'ENOENT') return resolve('not-found');
      return reject(error);
    });
    child.on('close', (code, signal) => {
      release();
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
