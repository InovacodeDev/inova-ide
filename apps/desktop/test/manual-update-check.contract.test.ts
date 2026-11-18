import { describe, expect, test } from 'vitest';
import { manualCheckStatus } from '../src/renderer/update-state';

describe('manualCheckStatus', () => {
  test('reports up to date when no newer version exists', () => {
    const result = manualCheckStatus({
      ok: true,
      value: { current: '0.10.0', latest: '0.10.0', available: false, releaseUrl: null },
    });
    expect(result).toEqual({ kind: 'upToDate', current: '0.10.0' });
  });

  test('reports the new version when one is available', () => {
    const result = manualCheckStatus({
      ok: true,
      value: { current: '0.10.0', latest: '0.11.0', available: true, releaseUrl: null },
    });
    expect(result).toEqual({ kind: 'available', current: '0.10.0', latest: '0.11.0' });
  });
});
