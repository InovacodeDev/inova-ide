import { expect, test } from 'vitest';
import {
  parseBinding,
  parseFileSearch,
  parseLoginCode,
  parseNewAccount,
  parseMessage,
  parseNewSession,
  parsePath,
  parseProjectRef,
  parseRemoval,
  parseSessionRef,
  parseSessionUpdate,
  parseUsageRequest,
  parseWorkspace,
} from '../src/main/validation.js';

test('array and primitive inputs are rejected', () => {
  for (const input of [[], [1, 2], 'x', 7, null, undefined]) {
    expect(parseNewAccount(input)).toBeUndefined();
    expect(parseRemoval(input)).toBeUndefined();
    expect(parsePath(input)).toBeUndefined();
    expect(parseBinding(input)).toBeUndefined();
    expect(parseProjectRef(input)).toBeUndefined();
    expect(parseNewSession(input)).toBeUndefined();
    expect(parseSessionRef(input)).toBeUndefined();
    expect(parseSessionUpdate(input)).toBeUndefined();
    expect(parseWorkspace(input)).toBeUndefined();
    expect(parseMessage(input)).toBeUndefined();
    expect(parseUsageRequest(input)).toBeUndefined();
    expect(parseLoginCode(input)).toBeUndefined();
  }
});

test('labels and ids accept 255 characters and reject 256', () => {
  const label = 'a'.repeat(255);
  expect(parseNewAccount({ provider: 'claude', label })).toEqual({ provider: 'claude', label });
  expect(parseNewAccount({ provider: 'claude', label: `${label}a` })).toBeUndefined();
  expect(parseProjectRef({ projectId: label })).toEqual({ projectId: label });
  expect(parseProjectRef({ projectId: `${label}a` })).toBeUndefined();
});

test('session ids must be safe path segments', () => {
  for (const sessionId of ['', '.', '..', 'a/b', 'a\\b', '../x', 'a\0b']) {
    expect(parseSessionRef({ sessionId })).toBeUndefined();
    expect(parseMessage({ sessionId, prompt: 'oi' })).toBeUndefined();
    expect(parseSessionUpdate({ sessionId, title: 't' })).toBeUndefined();
  }
  expect(parseSessionRef({ sessionId: 'abc-123' })).toEqual({ sessionId: 'abc-123' });
});

test('new sessions default the parent to null and validate it', () => {
  expect(parseNewSession({ projectId: 'p' })).toEqual({ projectId: 'p', parentId: null });
  expect(parseNewSession({ projectId: 'p', parentId: null })).toEqual({
    projectId: 'p',
    parentId: null,
  });
  expect(parseNewSession({ projectId: 'p', parentId: 's' })).toEqual({
    projectId: 'p',
    parentId: 's',
  });
  expect(parseNewSession({ projectId: 'p', parentId: 5 })).toBeUndefined();
  expect(parseNewSession({ projectId: 'p', parentId: '' })).toBeUndefined();
});

test('prompts are trimmed and limited to 100000 characters', () => {
  expect(parseMessage({ sessionId: 's', prompt: '  oi \n' })).toEqual({
    sessionId: 's',
    prompt: 'oi',
  });
  expect(parseMessage({ sessionId: 's', prompt: '   ' })).toBeUndefined();
  expect(parseMessage({ sessionId: 's', prompt: 5 })).toBeUndefined();
  const longest = 'a'.repeat(100_000);
  expect(parseMessage({ sessionId: 's', prompt: longest })?.prompt).toBe(longest);
  expect(parseMessage({ sessionId: 's', prompt: `${longest}a` })).toBeUndefined();
});

test('session updates need a title or an archived flag of the right type', () => {
  expect(parseSessionUpdate({ sessionId: 's', title: 'novo' })).toEqual({
    sessionId: 's',
    title: 'novo',
  });
  expect(parseSessionUpdate({ sessionId: 's', archived: true })).toEqual({
    sessionId: 's',
    archived: true,
  });
  expect(parseSessionUpdate({ sessionId: 's', title: 'a', archived: false })).toEqual({
    sessionId: 's',
    title: 'a',
    archived: false,
  });
  expect(parseSessionUpdate({ sessionId: 's', model: 'opus', effort: 'high' })).toEqual({
    sessionId: 's',
    model: 'opus',
    effort: 'high',
  });
  expect(parseSessionUpdate({ sessionId: 's', model: null, effort: null })).toEqual({
    sessionId: 's',
    model: null,
    effort: null,
  });
  expect(parseSessionUpdate({ sessionId: 's' })).toBeUndefined();
  expect(parseSessionUpdate({ sessionId: 's', title: '' })).toBeUndefined();
  expect(parseSessionUpdate({ sessionId: 's', archived: 'yes' })).toBeUndefined();
  expect(parseSessionUpdate({ sessionId: 's', title: 3 })).toBeUndefined();
  expect(parseSessionUpdate({ sessionId: 's', model: '   ' })).toBeUndefined();
  expect(parseSessionUpdate({ sessionId: 's', model: 3 })).toBeUndefined();
  expect(parseSessionUpdate({ sessionId: 's', effort: 'turbo' })).toBeUndefined();
});

test('workspace needs safe ids and a null or string active id', () => {
  const workspace = { openSessionIds: ['a', 'b'], activeSessionId: 'a' };
  expect(parseWorkspace(workspace)).toEqual(workspace);
  expect(parseWorkspace({ openSessionIds: [], activeSessionId: null })).toEqual({
    openSessionIds: [],
    activeSessionId: null,
  });
  expect(parseWorkspace({ openSessionIds: ['a/b'], activeSessionId: null })).toBeUndefined();
  expect(parseWorkspace({ openSessionIds: ['a'], activeSessionId: '..' })).toBeUndefined();
  expect(parseWorkspace({ openSessionIds: ['a'] })).toBeUndefined();
  expect(parseWorkspace({ openSessionIds: 'a', activeSessionId: null })).toBeUndefined();
  expect(parseWorkspace({ openSessionIds: [1], activeSessionId: null })).toBeUndefined();
  const many = Array.from({ length: 1001 }, (_, index) => `s${index}`);
  expect(parseWorkspace({ openSessionIds: many, activeSessionId: null })).toBeUndefined();
});

test('usage requests require their fields', () => {
  expect(parseUsageRequest({ accountLabel: 'a' })).toEqual({ accountLabel: 'a' });
  expect(parseUsageRequest({ accountLabel: '' })).toBeUndefined();
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

test('file search validates projectId, query length, and limit bounds', () => {
  expect(parseFileSearch({ projectId: 'p', query: '' })).toEqual({
    projectId: 'p',
    query: '',
    limit: 40,
  });
  expect(parseFileSearch({ projectId: 'p', query: 'chat', limit: 25 })).toEqual({
    projectId: 'p',
    query: 'chat',
    limit: 25,
  });
  expect(parseFileSearch({ projectId: '', query: 'a' })).toBeUndefined();
  expect(parseFileSearch({ projectId: 'p', query: 'a'.repeat(256) })).toBeUndefined();
  expect(parseFileSearch({ projectId: 'p', query: 'a', limit: 0 })).toBeUndefined();
  expect(parseFileSearch({ projectId: 'p', query: 'a', limit: 101 })).toBeUndefined();
  expect(parseFileSearch({ projectId: 'p', query: 'a', limit: 1.5 })).toBeUndefined();
});

test('login code requires safe sessionId and trimmed non-empty code up to 512 chars', () => {
  expect(parseLoginCode({ sessionId: 'sess-1', code: '  abc123  ' })).toEqual({
    sessionId: 'sess-1',
    code: 'abc123',
  });
  expect(parseLoginCode({ sessionId: 'sess-1', code: 'a'.repeat(512) })).toEqual({
    sessionId: 'sess-1',
    code: 'a'.repeat(512),
  });
  expect(parseLoginCode({ sessionId: 'sess-1', code: 'a'.repeat(513) })).toBeUndefined();
  expect(parseLoginCode({ sessionId: 'sess-1', code: '   ' })).toBeUndefined();
  expect(parseLoginCode({ sessionId: 'bad/id', code: 'abc' })).toBeUndefined();
  expect(parseLoginCode({ sessionId: '..', code: 'abc' })).toBeUndefined();
  expect(parseLoginCode({ sessionId: 'sess-1', code: 123 })).toBeUndefined();
});
