import { describe, expect, test } from 'vitest';
import type { VerificationCheck } from '@inova/core/types';
import { addCustomCheck, removeCheck, toggleCheck } from '../src/renderer/project-checks';

const checks: VerificationCheck[] = [
  { id: 'a', label: 'Testes', command: 'pnpm test', enabled: true },
  { id: 'b', label: 'Lint', command: 'pnpm lint', enabled: false },
];

describe('project checks', () => {
  test('toggleCheck flips only the matching check', () => {
    const next = toggleCheck({ checks, id: 'b' });
    expect(next.map((check) => check.enabled)).toEqual([true, true]);
  });

  test('removeCheck drops the matching check', () => {
    expect(removeCheck({ checks, id: 'a' }).map((check) => check.id)).toEqual(['b']);
  });

  test('addCustomCheck appends a trimmed enabled check with a short label', () => {
    const command = `  ${'x'.repeat(40)}  `;
    const next = addCustomCheck({ checks, command, id: 'custom-1' });
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({
      id: 'custom-1',
      label: 'x'.repeat(28),
      command: 'x'.repeat(40),
      enabled: true,
    });
  });

  test('addCustomCheck ignores a blank command', () => {
    expect(addCustomCheck({ checks, command: '   ', id: 'custom-2' })).toBe(checks);
  });
});
