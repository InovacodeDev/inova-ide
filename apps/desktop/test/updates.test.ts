import { describe, expect, test, vi } from 'vitest';
import {
  WINGET_PACKAGE_ID,
  appBundlePath,
  createUpdateInstaller,
  createUpdateService,
  parseWingetAvailableVersion,
} from '../src/main/updates';
import type { UpdateInstallerDeps } from '../src/main/updates';
import {
  compareVersions,
  fetchUpdateInfo,
  parseExternalUrl,
  parseLatestRelease,
} from '../src/main/updates-core';
import type { FetchLike } from '../src/main/updates-core';

function releaseFetch(body: unknown, status = 200): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

describe('compareVersions', () => {
  test('orders numerically, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.5.1', '0.5.2')).toBe(-1);
    expect(compareVersions('1.0.0', 'v1.0.0')).toBe(0);
  });

  test('ranks a prerelease below its release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
  });

  test('treats invalid input as equal', () => {
    expect(compareVersions('abc', '1.0.0')).toBe(0);
  });
});

describe('parseLatestRelease', () => {
  test('strips the v prefix and keeps a repository url', () => {
    const url = 'https://github.com/InovacodeDev/inova-ide/releases/tag/v0.6.0';
    expect(parseLatestRelease({ tag_name: 'v0.6.0', html_url: url })).toEqual({
      version: '0.6.0',
      releaseUrl: url,
    });
  });

  test('replaces a foreign url with the tag page', () => {
    expect(parseLatestRelease({ tag_name: 'v0.6.0', html_url: 'https://evil.test/x' })).toEqual({
      version: '0.6.0',
      releaseUrl: 'https://github.com/InovacodeDev/inova-ide/releases/tag/v0.6.0',
    });
  });

  test('rejects malformed payloads', () => {
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease([])).toBeNull();
    expect(parseLatestRelease({ tag_name: 'nightly' })).toBeNull();
    expect(parseLatestRelease({ tag_name: 6 })).toBeNull();
  });
});

describe('parseExternalUrl', () => {
  test('allows only repository urls', () => {
    const url = 'https://github.com/InovacodeDev/inova-ide/releases';
    expect(parseExternalUrl({ url })).toBe(url);
    expect(parseExternalUrl({ url: 'https://github.com/other/repo' })).toBeUndefined();
    expect(parseExternalUrl({ url: 'file:///etc/passwd' })).toBeUndefined();
    expect(parseExternalUrl('x')).toBeUndefined();
  });
});

describe('fetchUpdateInfo', () => {
  test('reports an available update', async () => {
    const result = await fetchUpdateInfo({
      current: '0.5.1',
      fetch: releaseFetch({ tag_name: 'v0.6.0' }),
    });
    expect(result).toEqual({
      ok: true,
      value: {
        current: '0.5.1',
        latest: '0.6.0',
        available: true,
        releaseUrl: 'https://github.com/InovacodeDev/inova-ide/releases/tag/v0.6.0',
      },
    });
  });

  test('reports up to date when the versions match', async () => {
    const result = await fetchUpdateInfo({
      current: '0.6.0',
      fetch: releaseFetch({ tag_name: 'v0.6.0' }),
    });
    expect(result.ok && result.value.available).toBe(false);
  });

  test('returns a failure on http errors, bad payloads and network errors', async () => {
    const failing: FetchLike = async () => {
      throw new Error('offline');
    };
    expect((await fetchUpdateInfo({ current: '0.5.1', fetch: releaseFetch({}, 403) })).ok).toBe(
      false,
    );
    expect((await fetchUpdateInfo({ current: '0.5.1', fetch: releaseFetch({}) })).ok).toBe(false);
    expect((await fetchUpdateInfo({ current: '0.5.1', fetch: failing })).ok).toBe(false);
  });
});

describe('createUpdateService', () => {
  test('announces each new version once', async () => {
    const onAvailable = vi.fn();
    const service = createUpdateService({
      current: '0.5.1',
      fetch: releaseFetch({ tag_name: 'v0.6.0' }),
      onAvailable,
    });
    await service.check();
    await service.check();
    expect(onAvailable).toHaveBeenCalledTimes(1);
  });

  test('stays silent when up to date and warns once on failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onAvailable = vi.fn();
    const upToDate = createUpdateService({
      current: '0.6.0',
      fetch: releaseFetch({ tag_name: 'v0.6.0' }),
      onAvailable,
    });
    await upToDate.check();
    expect(onAvailable).not.toHaveBeenCalled();

    const broken = createUpdateService({
      current: '0.5.1',
      fetch: async () => {
        throw new Error('offline');
      },
      onAvailable,
    });
    await broken.check();
    await broken.check();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

function installerDeps(overrides: Partial<UpdateInstallerDeps> = {}): UpdateInstallerDeps {
  return {
    platform: 'darwin',
    isPackaged: true,
    current: '0.5.5',
    execPath: '/Applications/InovaIDE.app/Contents/MacOS/InovaIDE',
    findBrew: async () => '/opt/homebrew/bin/brew',
    run: vi.fn(async () => undefined),
    readBundleVersion: vi.fn(async () => '0.5.6'),
    relaunch: vi.fn(),
    onProgress: vi.fn(),
    ...overrides,
  };
}

describe('appBundlePath', () => {
  test('extracts the .app bundle from the executable path', () => {
    expect(appBundlePath('/Applications/InovaIDE.app/Contents/MacOS/InovaIDE')).toBe(
      '/Applications/InovaIDE.app',
    );
    expect(appBundlePath('/usr/local/bin/electron')).toBeNull();
  });
});

describe('createUpdateInstaller', () => {
  test('upgrades the cask, clears quarantine and relaunches', async () => {
    const deps = installerDeps();
    expect(await createUpdateInstaller(deps).install()).toEqual({ ok: true, value: null });
    expect(vi.mocked(deps.run).mock.calls).toEqual([
      ['/opt/homebrew/bin/brew', ['update']],
      ['/opt/homebrew/bin/brew', ['upgrade', '--cask', 'inova-ide']],
      ['/usr/bin/xattr', ['-dr', 'com.apple.quarantine', '/Applications/InovaIDE.app']],
    ]);
    expect(deps.relaunch).toHaveBeenCalledTimes(1);
  });

  test('reports each install stage before the step runs', async () => {
    const order: string[] = [];
    const deps = installerDeps({
      run: vi.fn(async (_file: string, args: string[]) => {
        order.push(`run:${args[0] ?? ''}`);
      }),
      onProgress: vi.fn((stage) => {
        order.push(stage);
      }),
      relaunch: vi.fn(() => {
        order.push('relaunch');
      }),
    });
    await createUpdateInstaller(deps).install();
    expect(order).toEqual([
      'preparing',
      'fetching',
      'run:update',
      'downloading',
      'run:upgrade',
      'finalizing',
      'run:-dr',
      'restarting',
      'relaunch',
    ]);
  });

  test('stops reporting progress when a step fails', async () => {
    const deps = installerDeps({
      run: vi.fn(async (_file: string, args: string[]) => {
        if (args[0] === 'upgrade') throw new Error('brew exited with 1');
      }),
    });
    await createUpdateInstaller(deps).install();
    expect(vi.mocked(deps.onProgress).mock.calls.map(([stage]) => stage)).toEqual([
      'preparing',
      'fetching',
      'downloading',
    ]);
  });

  test('refuses outside a packaged macOS app', async () => {
    for (const overrides of [
      { platform: 'linux' as const },
      { isPackaged: false },
      { execPath: '/usr/local/bin/electron' },
    ]) {
      const deps = installerDeps(overrides);
      expect((await createUpdateInstaller(deps).install()).ok).toBe(false);
      expect(deps.run).not.toHaveBeenCalled();
      expect(deps.relaunch).not.toHaveBeenCalled();
    }
  });

  test('fails without relaunching when Homebrew is missing or the upgrade fails', async () => {
    const missing = installerDeps({ findBrew: async () => undefined });
    expect((await createUpdateInstaller(missing).install()).ok).toBe(false);
    expect(missing.relaunch).not.toHaveBeenCalled();

    const broken = installerDeps({
      run: vi.fn(async () => {
        throw new Error('brew exited with 1');
      }),
    });
    const result = await createUpdateInstaller(broken).install();
    expect(result.ok).toBe(false);
    expect(broken.relaunch).not.toHaveBeenCalled();
  });

  test('does not relaunch when Homebrew still installs the current version', async () => {
    const stale = installerDeps({ readBundleVersion: vi.fn(async () => '0.5.5') });
    const result = await createUpdateInstaller(stale).install();
    expect(result.ok).toBe(false);
    expect(stale.readBundleVersion).toHaveBeenCalledWith('/Applications/InovaIDE.app');
    expect(stale.relaunch).not.toHaveBeenCalled();
  });

  test('shares one install while it is in flight', async () => {
    const deps = installerDeps();
    const installer = createUpdateInstaller(deps);
    await Promise.all([installer.install(), installer.install()]);
    expect(deps.run).toHaveBeenCalledTimes(3);
    expect(deps.relaunch).toHaveBeenCalledTimes(1);
  });
});

describe('parseWingetAvailableVersion', () => {
  test('extracts the highest valid version from winget show --versions output', () => {
    const output = [
      `Found InovaIDE [${WINGET_PACKAGE_ID}]`,
      'Versão',
      '-------',
      '0.8.0',
      '0.9.1',
      '0.9.0',
      '',
    ].join('\r\n');
    expect(parseWingetAvailableVersion(output)).toBe('0.9.1');
  });

  test('returns null when no version lines exist', () => {
    expect(parseWingetAvailableVersion('No package found matching input criteria.')).toBeNull();
  });
});

function winInstallerDeps(overrides: Partial<UpdateInstallerDeps> = {}): UpdateInstallerDeps {
  return installerDeps({
    platform: 'win32',
    current: '0.9.0',
    execPath: 'C:\\Users\\dev\\AppData\\Local\\Programs\\InovaIDE\\InovaIDE.exe',
    isWinInstalled: () => true,
    findWinget: async () => 'winget.exe',
    runOutput: vi.fn(async () => 'Version\r\n-------\r\n0.9.1\r\n0.9.0\r\n'),
    spawnWinUpgrade: vi.fn(async () => undefined),
    quit: vi.fn(),
    pid: 4242,
    ...overrides,
  });
}

describe('createUpdateInstaller (Windows Winget)', () => {
  test('verifies available version, spawns detached upgrade and quits', async () => {
    const deps = winInstallerDeps();
    expect(await createUpdateInstaller(deps).install()).toEqual({ ok: true, value: null });
    expect(deps.runOutput).toHaveBeenCalledWith('winget.exe', [
      'show',
      '--id',
      WINGET_PACKAGE_ID,
      '--exact',
      '--versions',
      '--accept-source-agreements',
    ]);
    expect(deps.spawnWinUpgrade).toHaveBeenCalledWith({
      winget: 'winget.exe',
      execPath: deps.execPath,
      pid: 4242,
    });
    expect(deps.quit).toHaveBeenCalledTimes(1);
    expect(deps.relaunch).not.toHaveBeenCalled();
    expect(vi.mocked(deps.onProgress).mock.calls.map(([stage]) => stage)).toEqual([
      'preparing',
      'fetching',
      'downloading',
      'restarting',
    ]);
  });

  test('refuses when running outside an installed Windows package', async () => {
    const deps = winInstallerDeps({ isWinInstalled: () => false });
    const result = await createUpdateInstaller(deps).install();
    expect(result.ok).toBe(false);
    expect(deps.findWinget).toBeDefined();
    expect(deps.spawnWinUpgrade).not.toHaveBeenCalled();
    expect(deps.quit).not.toHaveBeenCalled();
  });

  test('fails when winget is missing, query errors, or new version is not published yet', async () => {
    const missing = winInstallerDeps({ findWinget: async () => undefined });
    expect((await createUpdateInstaller(missing).install()).ok).toBe(false);
    expect(missing.quit).not.toHaveBeenCalled();

    const queryError = winInstallerDeps({
      runOutput: vi.fn(async () => {
        throw new Error('winget failed');
      }),
    });
    expect((await createUpdateInstaller(queryError).install()).ok).toBe(false);
    expect(queryError.spawnWinUpgrade).not.toHaveBeenCalled();

    const stale = winInstallerDeps({
      runOutput: vi.fn(async () => 'Version\r\n-------\r\n0.9.0\r\n'),
    });
    expect((await createUpdateInstaller(stale).install()).ok).toBe(false);
    expect(stale.spawnWinUpgrade).not.toHaveBeenCalled();
    expect(stale.quit).not.toHaveBeenCalled();
  });

  test('fails without quitting when spawning the updater fails', async () => {
    const broken = winInstallerDeps({
      spawnWinUpgrade: vi.fn(async () => {
        throw new Error('spawn ENOENT');
      }),
    });
    expect((await createUpdateInstaller(broken).install()).ok).toBe(false);
    expect(broken.quit).not.toHaveBeenCalled();
  });
});
