import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VerificationCheckResult } from './chat-types.js';
import type { VerificationCheck } from './types.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 16 * 1024;
const KILL_GRACE_MS = 1_500;

function detectPackageManagerPrefix(projectPath: string): string {
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm run';
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(projectPath, 'bun.lockb')) || existsSync(join(projectPath, 'bun.lock'))) {
    return 'bun run';
  }
  return 'npm run';
}

async function readPackageScripts(pkgPath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(pkgPath, 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    return parsed.scripts ?? {};
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function detectProjectChecks(projectPath: string): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    const scripts = await readPackageScripts(pkgPath);
    if (scripts) {
      const runner = detectPackageManagerPrefix(projectPath);
      const candidates: Array<{ key: string; label: string }> = [
        { key: 'typecheck', label: 'Typecheck' },
        { key: 'lint', label: 'Lint' },
        { key: 'test', label: 'Testes' },
      ];
      for (const item of candidates) {
        if (typeof scripts[item.key] === 'string' && scripts[item.key] !== '') {
          checks.push({
            id: item.key,
            label: item.label,
            command: `${runner} ${item.key}`,
            enabled: true,
          });
        }
      }
    }
  }

  if (existsSync(join(projectPath, 'Cargo.toml'))) {
    checks.push(
      {
        id: 'cargo-clippy',
        label: 'Clippy',
        command: 'cargo clippy -- -D warnings',
        enabled: true,
      },
      { id: 'cargo-test', label: 'Cargo Test', command: 'cargo test', enabled: true },
    );
  }

  if (existsSync(join(projectPath, 'pubspec.yaml'))) {
    checks.push(
      {
        id: 'flutter-analyze',
        label: 'Flutter Analyze',
        command: 'flutter analyze',
        enabled: true,
      },
      { id: 'flutter-test', label: 'Flutter Test', command: 'flutter test', enabled: true },
    );
  }

  if (existsSync(join(projectPath, 'pyproject.toml'))) {
    checks.push(
      { id: 'ruff', label: 'Ruff', command: 'ruff check .', enabled: true },
      { id: 'pytest', label: 'Pytest', command: 'pytest', enabled: true },
    );
  }

  return checks;
}

function appendCapped(chunks: Buffer[], chunk: Buffer, totalRef: { bytes: number }): void {
  chunks.push(chunk);
  totalRef.bytes += chunk.length;
  while (totalRef.bytes > MAX_OUTPUT_BYTES && chunks.length > 1) {
    const removed = chunks.shift()!;
    totalRef.bytes -= removed.length;
  }
}

function decodeTail(chunks: Buffer[]): string {
  const combined = Buffer.concat(chunks);
  const sliced =
    combined.length > MAX_OUTPUT_BYTES
      ? combined.subarray(combined.length - MAX_OUTPUT_BYTES)
      : combined;
  return sliced.toString('utf8').trim();
}

function killGroup(pid: number | undefined, sig: NodeJS.Signals): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    try {
      process.kill(pid, sig);
    } catch {
      return;
    }
    return;
  }
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      process.kill(pid, sig);
    } catch {
      return;
    }
  }
}

async function runSingleCheck(input: {
  cwd: string;
  check: VerificationCheck;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<VerificationCheckResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows
      ? process.env['ComSpec'] || 'cmd.exe'
      : process.env['SHELL'] || '/bin/sh';
    const shellArgs = isWindows
      ? ['/d', '/s', '/c', input.check.command]
      : ['-c', input.check.command];
    const child = spawn(shell, shellArgs, {
      cwd: input.cwd,
      env: input.env,
      detached: !isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    const totalRef = { bytes: 0 };
    let timedOut = false;
    let settled = false;
    let hardKillTimer: ReturnType<typeof setTimeout> | undefined;

    const terminate = () => {
      killGroup(child.pid, 'SIGTERM');
      hardKillTimer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), KILL_GRACE_MS);
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, input.timeoutMs);

    const onAbort = () => terminate();
    input.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      input.signal?.removeEventListener('abort', onAbort);
      resolve({
        id: input.check.id,
        label: input.check.label,
        command: input.check.command,
        passed: !timedOut && exitCode === 0,
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        output: decodeTail(chunks),
      });
    };

    child.stdout.on('data', (chunk: Buffer) => appendCapped(chunks, chunk, totalRef));
    child.stderr.on('data', (chunk: Buffer) => appendCapped(chunks, chunk, totalRef));
    child.once('error', (error) => {
      appendCapped(chunks, Buffer.from(error.message, 'utf8'), totalRef);
      finish(1);
    });
    child.once('close', (code) => finish(code));
  });
}

export async function runVerificationChecks(input: {
  cwd: string;
  checks: readonly VerificationCheck[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (results: VerificationCheckResult[]) => void;
}): Promise<{ status: 'passed' | 'failed'; checks: VerificationCheckResult[] }> {
  const active = input.checks.filter((check) => check.enabled);
  const results: VerificationCheckResult[] = [];
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = input.env ?? process.env;

  for (const check of active) {
    if (input.signal?.aborted) break;
    const result = await runSingleCheck({
      cwd: input.cwd,
      check,
      env,
      timeoutMs,
      signal: input.signal,
    });
    results.push(result);
    input.onProgress?.([...results]);
  }

  const passed = results.length > 0 && results.every((item) => item.passed);
  return { status: passed ? 'passed' : 'failed', checks: results };
}
