import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { findBinary, loginShellPath } from '../src/main/shell-env.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'inova-shell-env-'));
}

async function fakeShell(body: string): Promise<string> {
  const path = join(await tempDir(), 'shell.sh');
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

test('loginShellPath returns PATH after marker even with rc noise', async () => {
  const shell = await fakeShell('printf "bem-vindo\\n__INOVA_PATH__/a:/b"');
  expect(await loginShellPath({ shell, fallback: '/fb', timeoutMs: 5000 })).toBe('/a:/b');
});

test('loginShellPath falls back when shell fails', async () => {
  const shell = await fakeShell('exit 3');
  expect(await loginShellPath({ shell, fallback: '/fb', timeoutMs: 5000 })).toBe('/fb');
});

test('loginShellPath falls back when shell is missing', async () => {
  const result = await loginShellPath({ shell: '/nao/existe', fallback: '/fb', timeoutMs: 5000 });
  expect(result).toBe('/fb');
});

test('loginShellPath falls back on timeout', async () => {
  const shell = await fakeShell('exec sleep 5');
  expect(await loginShellPath({ shell, fallback: '/fb', timeoutMs: 200 })).toBe('/fb');
});

test('loginShellPath falls back quickly when the shell ignores SIGTERM', async () => {
  const shell = await fakeShell("trap '' TERM\nexec sleep 5");
  const startedAt = Date.now();
  expect(await loginShellPath({ shell, fallback: '/fb', timeoutMs: 200 })).toBe('/fb');
  expect(Date.now() - startedAt).toBeLessThan(2000);
});

test('loginShellPath falls back when the marker is followed by an empty PATH', async () => {
  const shell = await fakeShell('printf "__INOVA_PATH__"');
  expect(await loginShellPath({ shell, fallback: '/fb', timeoutMs: 5000 })).toBe('/fb');
});

test('findBinary returns first executable match', async () => {
  const first = await tempDir();
  const second = await tempDir();
  for (const dir of [first, second]) {
    await writeFile(join(dir, 'claude'), '#!/bin/sh\n');
    await chmod(join(dir, 'claude'), 0o755);
  }
  expect(await findBinary('claude', `::${first}:${second}`)).toBe(join(first, 'claude'));
});

test('findBinary skips non-executable files and directories', async () => {
  const plain = await tempDir();
  const withDir = await tempDir();
  await writeFile(join(plain, 'claude'), 'x');
  await chmod(join(plain, 'claude'), 0o644);
  await mkdir(join(withDir, 'claude'));
  expect(await findBinary('claude', `${plain}:${withDir}`)).toBeUndefined();
});
