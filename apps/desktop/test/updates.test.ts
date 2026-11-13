import { describe, expect, test, vi } from 'vitest';
import { createUpdateService } from '../src/main/updates';
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
