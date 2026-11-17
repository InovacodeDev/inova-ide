import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findBinaryInPath,
  normalizeWindowsEnv,
  readEnvPath,
  readEnvVar,
  resolveWindowsSpawn,
} from './win-env.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'inova-win-env-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

describe('win-env edge cases', () => {
  it('reads Path case-insensitively from plain objects', () => {
    expect(readEnvPath({ Path: 'C:\\Windows\\System32' })).toBe('C:\\Windows\\System32');
    expect(readEnvPath({ path: 'C:\\tools' })).toBe('C:\\tools');
    expect(readEnvPath({ PATH: 'C:\\primary', Path: 'C:\\secondary' })).toBe('C:\\primary');
    expect(readEnvPath({})).toBe('');
    expect(readEnvVar({ ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, 'COMSPEC')).toBe(
      'C:\\Windows\\System32\\cmd.exe',
    );
  });

  it('normalizes mixed-case Path keys into a single PATH key', () => {
    const normalized = normalizeWindowsEnv({
      Path: 'C:\\one',
      path: 'C:\\two',
      USERPROFILE: 'C:\\Users\\Leo',
    });
    expect(normalized).toEqual({
      USERPROFILE: 'C:\\Users\\Leo',
      PATH: 'C:\\one',
    });
    expect(Object.keys(normalized)).toEqual(['USERPROFILE', 'PATH']);
  });

  it('prefers .exe and .cmd over extensionless POSIX shims on win32', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'claude'), '#!/bin/sh\n');
    await chmod(join(dir, 'claude'), 0o755);
    await writeFile(join(dir, 'claude.cmd'), '@echo off\r\n');

    expect(
      await findBinaryInPath({
        name: 'claude',
        pathValue: `"${dir}"`,
        platform: 'win32',
        delimiter: ';',
      }),
    ).toBe(join(dir, 'claude.cmd'));

    await writeFile(join(dir, 'claude.exe'), 'MZ');
    expect(
      await findBinaryInPath({ name: 'claude', pathValue: dir, platform: 'win32', delimiter: ';' }),
    ).toBe(join(dir, 'claude.exe'));
  });

  it('matches explicit extensions directly on win32', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'claude.exe'), 'MZ');
    expect(
      await findBinaryInPath({
        name: 'claude.exe',
        pathValue: dir,
        platform: 'win32',
        delimiter: ';',
      }),
    ).toBe(join(dir, 'claude.exe'));
  });

  it('wraps .cmd and .bat commands with cmd.exe /d /s /c on win32 and quotes spaces', () => {
    expect(
      resolveWindowsSpawn({
        file: 'C:\\Program Files\\pnpm\\claude.cmd',
        args: ['auth', 'login', 'hello world'],
        env: { comspec: 'C:\\Windows\\System32\\cmd.exe' },
        platform: 'win32',
      }),
    ).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\Program Files\\pnpm\\claude.cmd" auth login "hello world""'],
      verbatimArgs: '/d /s /c ""C:\\Program Files\\pnpm\\claude.cmd" auth login "hello world""',
    });

    expect(
      resolveWindowsSpawn({
        file: 'C:\\Users\\Leo\\.local\\bin\\claude.exe',
        args: ['auth', 'login'],
        env: {},
        platform: 'win32',
      }),
    ).toEqual({
      file: 'C:\\Users\\Leo\\.local\\bin\\claude.exe',
      args: ['auth', 'login'],
    });
  });
});
