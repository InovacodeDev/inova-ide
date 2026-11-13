import { describe, expect, test } from 'vitest';
import { contextLabel, formatTokens } from '../src/renderer/token-format';

describe('formatTokens', () => {
  test.each([
    [0, '0'],
    [950, '950'],
    [12_300, '12,3k'],
    [48_200, '48,2k'],
    [200_000, '200k'],
    [999_960, '1M'],
    [1_000_000, '1M'],
    [1_500_000, '1,5M'],
  ])('formats %i as %s', (value, expected) => {
    expect(formatTokens(value)).toBe(expected);
  });
});

describe('contextLabel', () => {
  test('shows used, window and percent', () => {
    expect(contextLabel({ usedTokens: 48_200, windowTokens: 200_000, model: 'm' })).toEqual({
      text: '48,2k / 200k · 24%',
      percent: 24,
    });
  });

  test('omits the percent without a window', () => {
    expect(contextLabel({ usedTokens: 24_885, windowTokens: null, model: null })).toEqual({
      text: '24,9k',
      percent: null,
    });
  });

  test('caps the percent at 100', () => {
    expect(contextLabel({ usedTokens: 300_000, windowTokens: 200_000, model: null }).percent).toBe(
      100,
    );
  });

  test('returns a dash when unknown', () => {
    expect(contextLabel(undefined)).toEqual({ text: '—', percent: null });
  });
});
