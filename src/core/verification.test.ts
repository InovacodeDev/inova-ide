import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { detectProjectChecks, runVerificationChecks } from './verification.js';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('verification', () => {
  test('detectProjectChecks detects node scripts with pnpm lockfile awareness', async () => {
    const dir = await makeTempDir('inova-verify-node-');
    await writeFile(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        scripts: {
          typecheck: 'tsc --noEmit',
          lint: 'eslint .',
          test: 'vitest run',
          build: 'vite build',
        },
      }),
    );

    const checks = await detectProjectChecks(dir);
    expect(checks.map((c) => [c.id, c.command])).toEqual([
      ['typecheck', 'pnpm run typecheck'],
      ['lint', 'pnpm run lint'],
      ['test', 'pnpm run test'],
    ]);
  });

  test('detectProjectChecks detects Cargo, Flutter, and Python projects', async () => {
    const rustDir = await makeTempDir('inova-verify-rust-');
    await writeFile(join(rustDir, 'Cargo.toml'), '[package]\nname = "demo"\n');
    expect((await detectProjectChecks(rustDir)).map((c) => c.command)).toEqual([
      'cargo clippy -- -D warnings',
      'cargo test',
    ]);

    const pyDir = await makeTempDir('inova-verify-py-');
    await writeFile(join(pyDir, 'pyproject.toml'), '[project]\nname = "demo"\n');
    expect((await detectProjectChecks(pyDir)).map((c) => c.command)).toEqual([
      'ruff check .',
      'pytest',
    ]);
  });

  test('runVerificationChecks runs enabled checks, truncates long output, and handles timeout/abort', async () => {
    const dir = await makeTempDir('inova-verify-run-');
    const result = await runVerificationChecks({
      cwd: dir,
      checks: [
        { id: 'ok', label: 'OK', command: 'echo ok-line', enabled: true },
        { id: 'skip', label: 'Skip', command: 'exit 1', enabled: false },
        {
          id: 'fail',
          label: 'Fail',
          command: 'node -e "console.error(\'X\'.repeat(20000)); process.exit(2)"',
          enabled: true,
        },
      ],
    });

    expect(result.status).toBe('failed');
    expect(result.checks).toHaveLength(2);
    expect(result.checks[0]?.passed).toBe(true);
    expect(result.checks[1]?.passed).toBe(false);
    expect(result.checks[1]?.exitCode).toBe(2);
    expect(Buffer.byteLength(result.checks[1]?.output ?? '', 'utf8')).toBeLessThanOrEqual(
      16 * 1024 + 64,
    );

    const timedOut = await runVerificationChecks({
      cwd: dir,
      checks: [{ id: 'slow', label: 'Slow', command: 'sleep 5', enabled: true }],
      timeoutMs: 80,
    });
    expect(timedOut.status).toBe('failed');
    expect(timedOut.checks[0]?.timedOut).toBe(true);
  });
});
