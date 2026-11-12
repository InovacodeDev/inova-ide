import { expect, test } from 'vitest';
import {
  parseBinding,
  parseNewAccount,
  parsePath,
  parseProjectLaunch,
  parseRemoval,
} from '../src/main/validation.js';

test('array and primitive inputs are rejected', () => {
  for (const input of [[], [1, 2], 'x', 7, null, undefined]) {
    expect(parseNewAccount(input)).toBeUndefined();
    expect(parseRemoval(input)).toBeUndefined();
    expect(parsePath(input)).toBeUndefined();
    expect(parseBinding(input)).toBeUndefined();
    expect(parseProjectLaunch(input)).toBeUndefined();
  }
});

test('labels and ids accept 255 characters and reject 256', () => {
  const label = 'a'.repeat(255);
  expect(parseNewAccount({ provider: 'claude', label })).toEqual({ provider: 'claude', label });
  expect(parseNewAccount({ provider: 'claude', label: `${label}a` })).toBeUndefined();
  const launch = { cols: 80, rows: 24 };
  expect(parseProjectLaunch({ projectId: `${label}a`, ...launch })).toBeUndefined();
});

test('extra fields are ignored', () => {
  const parsed = parseNewAccount({ provider: 'claude', label: 'a', admin: true });
  expect(parsed).toEqual({ provider: 'claude', label: 'a' });
  expect(parseRemoval({ label: 'a', force: false, extra: 1 })).toEqual({
    label: 'a',
    force: false,
  });
});

test('paths must be absolute and at most 4096 characters', () => {
  expect(parsePath({ path: 'relative/dir' })).toBeUndefined();
  expect(parsePath({ path: '' })).toBeUndefined();
  const longest = `/${'a'.repeat(4095)}`;
  expect(parsePath({ path: longest })).toEqual({ path: longest });
  expect(parsePath({ path: `${longest}a` })).toBeUndefined();
  expect(parseBinding({ path: 'rel', accountLabel: 'a' })).toBeUndefined();
  expect(parseBinding({ path: '/abs', accountLabel: 'a'.repeat(256) })).toBeUndefined();
  expect(parseBinding({ path: '/abs', accountLabel: 'a' })).toEqual({
    path: '/abs',
    accountLabel: 'a',
  });
});
