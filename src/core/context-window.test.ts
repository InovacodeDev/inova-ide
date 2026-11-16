import { describe, expect, it } from 'vitest';
import { contextWindowFor, rememberContextWindow } from './context-window.js';

describe('contextWindowFor', () => {
  it.each([
    ['claude-unreported-model', null],
    ['claude-unreported-model[1m]', 1_000_000],
    ['gpt-5', null],
    [null, null],
  ] as const)('maps %s without a reported window', (model, expected) => {
    expect(contextWindowFor(model)).toBe(expected);
  });

  it('uses the window the CLI reported for the model', () => {
    rememberContextWindow({ model: 'claude-window-test-long', windowTokens: 1_000_000 });
    rememberContextWindow({ model: 'Claude-Window-Test-Short', windowTokens: 200_000 });
    expect(contextWindowFor('claude-window-test-long')).toBe(1_000_000);
    expect(contextWindowFor('claude-window-test-short')).toBe(200_000);
  });

  it('ignores invalid reported windows', () => {
    rememberContextWindow({ model: 'claude-window-test-invalid', windowTokens: 0 });
    rememberContextWindow({ model: 'claude-window-test-invalid', windowTokens: Number.NaN });
    expect(contextWindowFor('claude-window-test-invalid')).toBeNull();
  });
});
