import { describe, expect, test } from 'vitest';
import { resolveTheme } from '../src/renderer/theme';

describe('resolveTheme', () => {
  test('explicit preferences ignore the system setting', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });

  test('system follows the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });
});
