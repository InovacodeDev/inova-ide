import { describe, expect, test } from 'vitest';
import { SETTINGS_SECTIONS, moveSection } from '../src/renderer/settings-sections';

describe('moveSection', () => {
  test('moves to the neighbor section', () => {
    expect(moveSection({ current: 'general', delta: 1 })).toBe('models');
    expect(moveSection({ current: 'voice', delta: -1 })).toBe('notifications');
  });

  test('wraps around both ends', () => {
    expect(moveSection({ current: 'shortcuts', delta: 1 })).toBe('general');
    expect(moveSection({ current: 'general', delta: -1 })).toBe('shortcuts');
  });

  test('exposes the seven sections once each', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      'general',
      'models',
      'sessions',
      'notifications',
      'voice',
      'library',
      'shortcuts',
    ]);
  });
});
