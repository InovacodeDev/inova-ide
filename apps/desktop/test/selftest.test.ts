import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('selftest spawns a pty and resolves the core', async () => {
  const electronBinary = (await import('electron')).default as unknown as string;
  const env: NodeJS.ProcessEnv = { ...process.env, INOVA_SELFTEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;

  const args =
    process.platform === 'linux' ? ['--no-sandbox', 'out/main/index.js'] : ['out/main/index.js'];
  const result = spawnSync(electronBinary, args, {
    cwd: resolve(import.meta.dirname, '..'),
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('selftest:pty-ok:claude,codex,gemini');
});
