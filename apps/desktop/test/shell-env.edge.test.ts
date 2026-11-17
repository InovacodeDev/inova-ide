import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { addAccount } from '@inova/core/accounts';
import { createHandlers } from '../src/main/handlers.js';
import {
  expandWindowsEnvVars,
  findBinary,
  mergePathEntries,
  parseRegQueryPath,
  windowsBaseEnv,
  windowsPath,
  windowsUserCliDirs,
} from '../src/main/shell-env.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'inova-shell-env-edge-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

test('findBinary skips extensionless POSIX shim and picks .cmd on win32', async () => {
  const dir = await makeTempDir();
  await writeFile(join(dir, 'claude'), '#!/bin/sh\n');
  await chmod(join(dir, 'claude'), 0o755);
  await writeFile(join(dir, 'claude.cmd'), '@echo off\r\n');

  const found = await findBinary('claude', `"${dir}"`, { platform: 'win32', delimiter: ';' });
  expect(found).toBe(join(dir, 'claude.cmd'));
});

test('parseRegQueryPath extracts REG_SZ and REG_EXPAND_SZ values', () => {
  const expandOut = [
    '',
    'HKEY_CURRENT_USER\\Environment',
    '    Path    REG_EXPAND_SZ    %USERPROFILE%\\.local\\bin;C:\\tools',
    '',
  ].join('\r\n');
  expect(parseRegQueryPath(expandOut)).toBe('%USERPROFILE%\\.local\\bin;C:\\tools');

  const szOut = 'HKEY_LOCAL_MACHINE\\...\r\n    PATH    REG_SZ    C:\\Windows\\System32\r\n';
  expect(parseRegQueryPath(szOut)).toBe('C:\\Windows\\System32');
  expect(
    parseRegQueryPath('ERROR: The system was unable to find the specified registry key.'),
  ).toBeUndefined();
});

test('expandWindowsEnvVars resolves case-insensitive variables', () => {
  const expanded = expandWindowsEnvVars('%userprofile%\\.local\\bin;%UNKNOWN%\\bin', {
    USERPROFILE: 'C:\\Users\\Leonardo',
  });
  expect(expanded).toBe('C:\\Users\\Leonardo\\.local\\bin;%UNKNOWN%\\bin');
});

test('mergePathEntries strips quotes and deduplicates case-insensitively', () => {
  const merged = mergePathEntries({
    parts: [
      '"C:\\Users\\Leo\\.local\\bin";C:\\Windows\\System32',
      'c:\\users\\leo\\.local\\bin;D:\\pnpm',
    ],
    delimiter: ';',
    caseInsensitive: true,
  });
  expect(merged).toBe('C:\\Users\\Leo\\.local\\bin;C:\\Windows\\System32;D:\\pnpm');
});

test('windowsUserCliDirs includes native installer and package manager locations', () => {
  const dirs = windowsUserCliDirs({
    USERPROFILE: 'C:\\Users\\Leonardo',
    LOCALAPPDATA: 'C:\\Users\\Leonardo\\AppData\\Local',
    APPDATA: 'C:\\Users\\Leonardo\\AppData\\Roaming',
  });
  expect(dirs).toEqual([
    'C:\\Users\\Leonardo\\.local\\bin',
    'C:\\Users\\Leonardo\\AppData\\Local\\pnpm',
    'C:\\Users\\Leonardo\\AppData\\Roaming\\npm',
    'C:\\Users\\Leonardo\\AppData\\Local\\Microsoft\\WinGet\\Links',
    'C:\\Users\\Leonardo\\.bun\\bin',
    'C:\\Users\\Leonardo\\scoop\\shims',
    'C:\\Users\\Leonardo\\.cargo\\bin',
  ]);
});

test('windowsPath merges process Path, registry paths, and standard CLI directories', async () => {
  const path = await windowsPath({
    env: {
      Path: 'C:\\Windows\\System32;"C:\\Users\\Leonardo\\AppData\\Roaming\\npm"',
      USERPROFILE: 'C:\\Users\\Leonardo',
    },
    queryRegistryPath: async (key) => {
      if (key.startsWith('HKCU')) return '%USERPROFILE%\\.local\\bin;C:\\custom\\bin';
      if (key.startsWith('HKLM')) return 'C:\\Program Files\\nodejs;c:\\windows\\system32';
      return undefined;
    },
  });

  const entries = path.split(';');
  expect(entries).toContain('C:\\Windows\\System32');
  expect(entries).toContain('C:\\Users\\Leonardo\\AppData\\Roaming\\npm');
  expect(entries).toContain('C:\\Users\\Leonardo\\.local\\bin');
  expect(entries).toContain('C:\\custom\\bin');
  expect(entries).toContain('C:\\Program Files\\nodejs');
  expect(entries).toContain('C:\\Users\\Leonardo\\AppData\\Local\\pnpm');
  expect(entries.filter((entry) => entry.toLowerCase() === 'c:\\windows\\system32')).toHaveLength(
    1,
  );
});

test('windowsBaseEnv normalizes Path to PATH even when registry query fails', async () => {
  const env = await windowsBaseEnv({
    env: {
      Path: 'C:\\Windows\\System32',
      USERPROFILE: 'C:\\Users\\Leonardo',
    },
    queryRegistryPath: async () => undefined,
  });

  expect(env['Path']).toBeUndefined();
  expect(env['PATH']).toContain('C:\\Windows\\System32');
  expect(env['PATH']).toContain('C:\\Users\\Leonardo\\.local\\bin');
  expect(env['TERM']).toBe('xterm-256color');
  expect(env['COLORTERM']).toBe('truecolor');
});

test('startLogin locates claude when baseEnv uses Path instead of PATH', async () => {
  const root = await makeTempDir();
  const bin = await makeTempDir();
  await writeFile(join(bin, 'claude'), '#!/bin/sh\nexit 0\n');
  await chmod(join(bin, 'claude'), 0o755);

  const account = await addAccount({ root, provider: 'claude', label: 'Tevon' });
  const open = vi.fn(() => 'login-sess-1');
  const handlers = createHandlers({
    root,
    runner: { run: vi.fn(async () => ({ exitCode: 1, stdout: '{"loggedIn":false}' })) },
    sessions: {
      open,
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      closeAll: vi.fn(async () => undefined),
      accountsInUse: () => new Set(),
    },
    chat: {
      send: vi.fn(),
      cancel: vi.fn(),
      isRunning: () => false,
      accountsInUse: () => new Set(),
      closeAll: vi.fn(async () => undefined),
    },
    usageDeps: {
      platform: 'linux',
      runner: { run: vi.fn(async () => ({ exitCode: 0, stdout: '' })) },
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    },
    emit: vi.fn(),
    baseEnv: async () => ({ Path: bin }),
    pickFolder: async () => null,
    pickAttachments: async () => [],
  });

  try {
    const result = await handlers.startLogin({ accountLabel: account.label });
    expect(result).toEqual({
      ok: true,
      value: { sessionId: 'login-sess-1', accountLabel: 'Tevon', provider: 'claude' },
    });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ file: join(bin, 'claude') }));
  } finally {
    await handlers.flushPendingWrites();
  }
});
