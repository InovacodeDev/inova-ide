import { expect, test } from 'vitest';
import {
  parseApplyProfileSync,
  parseBinding,
  parseComparisonRef,
  parseDefaultMode,
  parseFileSearch,
  parseForkSession,
  parseHandoffSession,
  parseLoginCode,
  parseNewAccount,
  parseMessage,
  parseNewSession,
  parsePath,
  parsePreviewProfileSync,
  parseProjectRef,
  parseProjectVerification,
  parseRemoval,
  parseResolveComparison,
  parseRestoreCheckpoint,
  parseSessionDelete,
  parseSessionRef,
  parseSessionUpdate,
  parseSettingsPatch,
  parseStartComparison,
  parseSwitchAccount,
  parseTurnRef,
  parseUiFocus,
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
    extraDirs: [],
  });
  expect(
    parseMessage({ sessionId: 's', prompt: 'oi', extraDirs: ['/Users/me/Downloads'] })?.extraDirs,
  ).toEqual(['/Users/me/Downloads']);
  for (const extraDirs of ['/x', ['relative/dir'], ['/a\0b'], [5], new Array(17).fill('/x')]) {
    expect(parseMessage({ sessionId: 's', prompt: 'oi', extraDirs })).toBeUndefined();
  }
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

test('session mode update and default provider mode validation', () => {
  expect(parseSessionUpdate({ sessionId: 's1', mode: 'plan' })).toEqual({
    sessionId: 's1',
    mode: 'plan',
  });
  expect(parseSessionUpdate({ sessionId: 's1', mode: null })).toEqual({
    sessionId: 's1',
    mode: null,
  });
  expect(parseSessionUpdate({ sessionId: 's1', mode: 'bad-mode' })).toBeUndefined();
  expect(parseDefaultMode({ provider: 'claude', mode: 'plan' })).toEqual({
    provider: 'claude',
    mode: 'plan',
  });
  expect(parseDefaultMode({ provider: 'unknown', mode: 'plan' })).toBeUndefined();
  expect(parseDefaultMode({ provider: 'claude', mode: 'invalid' })).toBeUndefined();
});

test('settings patch validation rejects the whole patch on any unknown key or invalid value', () => {
  const valid = {
    voice: { language: 'pt' },
    sessions: { autoArchiveDays: 30, collapseFinishedTurns: false },
    notifications: { waitingInput: true, onlyWhenUnfocused: false },
  };
  expect(parseSettingsPatch(valid)).toEqual(valid);
  expect(parseSettingsPatch({})).toEqual({});
  expect(parseSettingsPatch({ sessions: { autoArchiveDays: 3 } })).toEqual({
    sessions: { autoArchiveDays: 3 },
  });
  for (const input of [
    null,
    'settings',
    [],
    { theme: 'dark' },
    { voice: { language: 'fr' } },
    { voice: { language: 'pt', volume: 1 } },
    { sessions: { autoArchiveDays: 2 } },
    { sessions: { autoArchiveDays: '7' } },
    { notifications: { completed: 'true' } },
    { notifications: 'all' },
    { voice: { language: 'pt' }, sessions: { autoArchiveDays: 99 } },
    JSON.parse('{"__proto__":{"language":"pt"}}'),
  ]) {
    expect(parseSettingsPatch(input)).toBeUndefined();
  }
});

test('worktree, checkpoint restore, and project verification validation', () => {
  expect(parseNewSession({ projectId: 'p1', isolatedWorktree: true })).toEqual({
    projectId: 'p1',
    parentId: null,
    isolatedWorktree: true,
  });
  expect(parseSessionDelete({ sessionId: 's1', force: true })).toEqual({
    sessionId: 's1',
    force: true,
  });
  expect(parseRestoreCheckpoint({ sessionId: 's1', ref: 'refs/inova/checkpoints/s1/t1' })).toEqual({
    sessionId: 's1',
    ref: 'refs/inova/checkpoints/s1/t1',
    preserveFiles: [],
  });
  expect(parseRestoreCheckpoint({ sessionId: 's1', ref: 'refs/heads/main' })).toBeUndefined();
  expect(
    parseProjectVerification({
      projectId: 'p1',
      autoWorktree: true,
      autoVerify: true,
      verificationChecks: [{ id: 't', label: 'Test', command: 'pnpm test', enabled: true }],
    }),
  ).toEqual({
    projectId: 'p1',
    autoWorktree: true,
    autoVerify: true,
    verificationChecks: [{ id: 't', label: 'Test', command: 'pnpm test', enabled: true }],
  });
  expect(parseProjectVerification({ projectId: 'p1' })).toBeUndefined();
});

test('orchestration, fork, handoff, queue, and uiFocus validation', () => {
  expect(parseTurnRef({ turnId: 't1' })).toEqual({ turnId: 't1' });
  expect(parseTurnRef({ turnId: '../x' })).toBeUndefined();
  expect(parseSwitchAccount({ sessionId: 's1', accountId: 'a2', generateHandoff: false })).toEqual({
    sessionId: 's1',
    accountId: 'a2',
    generateHandoff: false,
  });
  expect(
    parseHandoffSession({ sessionId: 's1', targetAccountId: 'a2', createWorktree: true }),
  ).toEqual({
    sessionId: 's1',
    targetAccountId: 'a2',
    createWorktree: true,
  });
  expect(
    parseForkSession({
      sessionId: 's1',
      turnIndex: 0,
      targetAccountId: 'a2',
      copyWorktreeFiles: true,
    }),
  ).toEqual({
    sessionId: 's1',
    turnIndex: 0,
    targetAccountId: 'a2',
    copyWorktreeFiles: true,
  });
  expect(parseForkSession({ sessionId: 's1', turnIndex: -1 })).toBeUndefined();
  expect(parseUiFocus({ activeSessionId: null, windowFocused: false })).toEqual({
    activeSessionId: null,
    windowFocused: false,
  });
});

test('comparison and profile sync validation', () => {
  expect(
    parseStartComparison({
      projectId: 'p1',
      prompt: 'Refatore módulo',
      leftAccountId: 'a1',
      rightAccountId: 'a2',
      leftEffort: 'high',
      rightMode: 'plan',
    }),
  ).toEqual({
    projectId: 'p1',
    prompt: 'Refatore módulo',
    leftAccountId: 'a1',
    rightAccountId: 'a2',
    leftEffort: 'high',
    rightMode: 'plan',
  });
  expect(
    parseStartComparison({
      projectId: 'p1',
      prompt: '   ',
      leftAccountId: 'a1',
      rightAccountId: 'a2',
    }),
  ).toBeUndefined();
  expect(parseComparisonRef({ groupId: 'g1' })).toEqual({ groupId: 'g1' });
  expect(parseComparisonRef({ groupId: '../bad' })).toBeUndefined();
  expect(parseResolveComparison({ groupId: 'g1', winner: 'left', cleanupWorktrees: true })).toEqual(
    {
      groupId: 'g1',
      winner: 'left',
      cleanupWorktrees: true,
    },
  );
  expect(parseResolveComparison({ groupId: 'g1', winner: 'center' })).toBeUndefined();
  expect(
    parsePreviewProfileSync({ projectId: 'p1', accountIds: ['a1'], rulesSource: 'AGENTS.md' }),
  ).toEqual({
    projectId: 'p1',
    accountIds: ['a1'],
    rulesSource: 'AGENTS.md',
  });
  expect(
    parseApplyProfileSync({
      projectId: 'p1',
      rulesSource: 'CLAUDE.md',
      approvedIds: ['rules:AGENTS.md'],
      rulesStrategy: 'symlink',
    }),
  ).toEqual({
    projectId: 'p1',
    rulesSource: 'CLAUDE.md',
    approvedIds: ['rules:AGENTS.md'],
    rulesStrategy: 'symlink',
  });
  expect(
    parseApplyProfileSync({ projectId: 'p1', approvedIds: [''], rulesStrategy: 'copy' }),
  ).toBeUndefined();
});
