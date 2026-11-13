import { describe, expect, it } from 'vitest';
import { contextWindowFor } from './context-window.js';

describe('contextWindowFor', () => {
  it.each([
    ['claude-opus-5-5', 200_000],
    ['claude-opus-5-5[1m]', 1_000_000],
    ['gpt-5', null],
    [null, null],
  ] as const)('maps %s', (model, expected) => {
    expect(contextWindowFor(model)).toBe(expected);
  });
});
