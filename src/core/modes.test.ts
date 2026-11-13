import { describe, expect, test } from 'vitest';
import {
  EXECUTION_MODES,
  PROVIDER_MODES,
  isExecutionMode,
  isModeSupported,
  resolveExecutionMode,
} from './modes.js';
import { providers } from './providers.js';
import type { ProviderId } from './types.js';

describe('execution modes catalog', () => {
  test('isExecutionMode recognizes only valid ExecutionMode strings', () => {
    for (const mode of EXECUTION_MODES) {
      expect(isExecutionMode(mode)).toBe(true);
    }
    expect(isExecutionMode('yolo')).toBe(false);
    expect(isExecutionMode('')).toBe(false);
    expect(isExecutionMode(null)).toBe(false);
    expect(isExecutionMode(42)).toBe(false);
  });

  test('every provider declares a valid catalog and defaultMode included in options', () => {
    const providerIds = Object.keys(providers) as ProviderId[];
    for (const id of providerIds) {
      const catalog = PROVIDER_MODES[id];
      expect(catalog).toBeDefined();
      expect(catalog.options.length).toBeGreaterThanOrEqual(2);
      expect(isModeSupported(id, catalog.defaultMode)).toBe(true);
      const uniqueIds = new Set(catalog.options.map((opt) => opt.id));
      expect(uniqueIds.size).toBe(catalog.options.length);
    }
  });

  test('isModeSupported enforces per-provider capabilities', () => {
    expect(isModeSupported('claude', 'plan')).toBe(true);
    expect(isModeSupported('claude', 'bypass')).toBe(true);
    expect(isModeSupported('claude', 'read-only')).toBe(false);
    expect(isModeSupported('codex', 'read-only')).toBe(true);
    expect(isModeSupported('codex', 'plan')).toBe(false);
    expect(isModeSupported('deepseek', 'read-only')).toBe(true);
    expect(isModeSupported('deepseek', 'bypass')).toBe(false);
  });

  test('resolveExecutionMode prioritizes session mode, then store default, then catalog default', () => {
    expect(
      resolveExecutionMode({
        provider: 'claude',
        sessionMode: 'plan',
        defaultModes: { claude: 'auto' },
      }),
    ).toBe('plan');

    expect(
      resolveExecutionMode({
        provider: 'claude',
        sessionMode: null,
        defaultModes: { claude: 'auto' },
      }),
    ).toBe('auto');

    expect(
      resolveExecutionMode({
        provider: 'claude',
        sessionMode: 'read-only',
        defaultModes: { claude: 'bypass' },
      }),
    ).toBe('bypass');

    expect(
      resolveExecutionMode({
        provider: 'claude',
      }),
    ).toBe('accept-edits');
  });
});
