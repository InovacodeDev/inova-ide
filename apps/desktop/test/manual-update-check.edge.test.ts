import { describe, expect, test } from 'vitest';
import { manualCheckStatus } from '../src/renderer/update-state';
import { translate } from '../src/renderer/i18n';

describe('manualCheckStatus edge cases', () => {
  test('surfaces the IPC error message', () => {
    expect(manualCheckStatus({ ok: false, message: 'offline' })).toEqual({
      kind: 'error',
      message: 'offline',
    });
  });

  test('reports unknown when no release is published', () => {
    const result = manualCheckStatus({
      ok: true,
      value: { current: '0.10.0', latest: null, available: false, releaseUrl: null },
    });
    expect(result).toEqual({ kind: 'unknown', current: '0.10.0' });
  });

  test('never reports available without a latest version', () => {
    const result = manualCheckStatus({
      ok: true,
      value: { current: '0.10.0', latest: null, available: true, releaseUrl: null },
    });
    expect(result.kind).toBe('unknown');
  });

  test('has pt-BR and en-US text for every status', () => {
    for (const locale of ['pt-BR', 'en-US'] as const) {
      for (const key of ['upToDate', 'available', 'unknown', 'error'] as const) {
        const text = translate(locale, `settings.updates.${key}`, { version: '1', message: 'm' });
        expect(text).not.toContain('settings.updates');
      }
    }
  });
});
