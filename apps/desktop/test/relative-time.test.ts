import { describe, expect, test } from 'vitest';
import { formatMessageTime, relativeTime } from '../src/renderer/relative-time';

const now = new Date('2026-01-10T12:00:00.000Z');
const ago = (ms: number) => relativeTime({ iso: new Date(now.getTime() - ms).toISOString(), now });
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  test('returns agora under one minute', () => {
    expect(ago(0)).toBe('agora');
    expect(ago(59_999)).toBe('agora');
  });

  test('returns minutes under one hour', () => {
    expect(ago(MIN)).toBe('1 min');
    expect(ago(59 * MIN)).toBe('59 min');
  });

  test('returns hours under one day', () => {
    expect(ago(HOUR)).toBe('1 h');
    expect(ago(23 * HOUR)).toBe('23 h');
  });

  test('returns ontem between 24h and 48h', () => {
    expect(ago(DAY)).toBe('ontem');
    expect(ago(47 * HOUR)).toBe('ontem');
  });

  test('returns days from 48h on', () => {
    expect(ago(2 * DAY)).toBe('2 d');
    expect(ago(10 * DAY)).toBe('10 d');
  });

  test('returns empty string for an invalid date', () => {
    expect(relativeTime({ iso: 'nope', now })).toBe('');
  });
});

describe('formatMessageTime', () => {
  test('formats local HH:MM', () => {
    expect(formatMessageTime('2026-11-13T14:30:00')).toBe('14:30');
  });

  test('returns empty string for an invalid date', () => {
    expect(formatMessageTime('nope')).toBe('');
  });
});
