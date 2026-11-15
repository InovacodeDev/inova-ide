import { describe, expect, test } from 'vitest';
import type { ChatEvent, UsageWindow } from './chat-types.js';
import {
  MAX_REVIEW_DIFF_CHARS,
  buildAdversarialReviewPrompt,
  buildHandoffContext,
  buildParentFixPrompt,
  formatPinnedMemoryBlock,
  hashPinnedMemory,
  isAuthRevokedMessage,
  isRateLimitMessage,
  peakUsagePercent,
  rankFailoverAccounts,
  selectFailoverAccount,
  selectReviewAccount,
  sliceTranscriptToTurn,
  truncateTranscriptAtTurn,
} from './handoff.js';
import type { Account, ProviderId } from './types.js';

describe('handoff', () => {
  test('isRateLimitMessage detects common quota and 429 errors', () => {
    expect(isRateLimitMessage('HTTP 429: rate limit exceeded')).toBe(true);
    expect(isRateLimitMessage('You reached your weekly usage limit')).toBe(true);
    expect(isRateLimitMessage('Insufficient quota on this account')).toBe(true);
    expect(isRateLimitMessage('SyntaxError: unexpected token')).toBe(false);
  });

  test('isAuthRevokedMessage detects revoked or invalid provider logins', () => {
    expect(
      isAuthRevokedMessage(
        'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has been revoked. Please obtain a new token or refresh an existing token."}}',
      ),
    ).toBe(true);
    expect(isAuthRevokedMessage('Invalid API key · Please run /login')).toBe(true);
    expect(isAuthRevokedMessage('OAuth token revoked · Please run /login')).toBe(true);
    expect(isAuthRevokedMessage('unexpected status 401 Unauthorized')).toBe(true);
    expect(isAuthRevokedMessage('You are not logged into Antigravity.')).toBe(true);
    expect(isAuthRevokedMessage('HTTP 429: rate limit exceeded')).toBe(false);
    expect(isAuthRevokedMessage('Tests failed: expected 401 to be 200')).toBe(false);
  });

  test('buildHandoffContext extracts objective, assistant progress, tools, git summary, and errors within maxChars', () => {
    const events: ChatEvent[] = [
      { kind: 'user', text: 'Implementar cache de sessão', at: '2026-11-13T00:00:00Z' },
      { kind: 'tool-use', toolId: 't1', name: 'edit_file', input: 'src/cache.ts' },
      { kind: 'tool-result', toolId: 't1', output: 'ok', isError: false },
      { kind: 'text', blockId: 'b1', text: 'Criei o cache em src/cache.ts com TTL.' },
      {
        kind: 'verification',
        turnId: 'turn-1',
        status: 'failed',
        checks: [
          {
            id: 'test',
            label: 'Testes',
            command: 'pnpm test',
            passed: false,
            timedOut: false,
            exitCode: 1,
            output: 'FAIL cache.test.ts',
            durationMs: 25,
          },
        ],
      },
      { kind: 'error', message: '429 Too Many Requests' },
    ];

    const summary = buildHandoffContext({
      events,
      gitSummary: ' M src/cache.ts\n 1 file changed, 20 insertions(+)',
      fromProvider: 'claude',
      toProvider: 'codex',
    });

    expect(summary).toContain('claude → codex');
    expect(summary).toContain('Implementar cache de sessão');
    expect(summary).toContain('edit_file');
    expect(summary).toContain('Criei o cache em src/cache.ts com TTL.');
    expect(summary).toContain('M src/cache.ts');
    expect(summary).toContain('FAIL cache.test.ts');
    expect(summary).toContain('429 Too Many Requests');

    const capped = buildHandoffContext({
      events: [{ kind: 'user', text: 'x'.repeat(20_000), at: '2026-11-13T00:00:00Z' }],
      fromProvider: 'claude',
      toProvider: 'gemini',
      maxChars: 1200,
    });
    expect(capped.length).toBeLessThanOrEqual(1200);
  });

  test('sliceTranscriptToTurn cuts transcript accurately and finds post-turn checkpoint', () => {
    const events: ChatEvent[] = [
      {
        kind: 'checkpoint',
        turnId: 'u0',
        ref: 'refs/inova/checkpoints/s/0',
        createdAt: 't0',
        skippedLargeFiles: [],
      },
      { kind: 'user', text: 'Turno 0', at: 't0' },
      { kind: 'text', blockId: 'b0', text: 'Resposta 0' },
      { kind: 'done', isError: false, costUsd: null, durationMs: 10 },
      {
        kind: 'checkpoint',
        turnId: 'u1',
        ref: 'refs/inova/checkpoints/s/1',
        createdAt: 't1',
        skippedLargeFiles: [],
      },
      { kind: 'user', text: 'Turno 1', at: 't1' },
      { kind: 'text', blockId: 'b1', text: 'Resposta 1' },
      { kind: 'done', isError: false, costUsd: null, durationMs: 12 },
    ];

    const slice0 = sliceTranscriptToTurn(events, 0);
    expect(slice0.isLatestTurn).toBe(false);
    expect(slice0.preTurnCheckpointRef).toBe('refs/inova/checkpoints/s/0');
    expect(slice0.postTurnCheckpointRef).toBe('refs/inova/checkpoints/s/1');
    expect(slice0.slicedEvents).toHaveLength(4);
    expect(slice0.slicedEvents.at(-1)?.kind).toBe('done');

    const slice1 = sliceTranscriptToTurn(events, 1);
    expect(slice1.isLatestTurn).toBe(true);
    expect(slice1.preTurnCheckpointRef).toBe('refs/inova/checkpoints/s/1');
    expect(slice1.postTurnCheckpointRef).toBeNull();
    expect(slice1.slicedEvents).toHaveLength(8);
  });

  describe('truncateTranscriptAtTurn', () => {
    const checkpoint = (n: number): ChatEvent => ({
      kind: 'checkpoint',
      turnId: `u${n}`,
      ref: `refs/inova/checkpoints/s/${n}`,
      createdAt: `t${n}`,
      skippedLargeFiles: [],
    });
    const withCheckpoints: ChatEvent[] = [
      checkpoint(0),
      { kind: 'user', text: 'Turno 0', at: 't0' },
      { kind: 'text', blockId: 'b0', text: 'Resposta 0' },
      { kind: 'done', isError: false, costUsd: null, durationMs: 10 },
      checkpoint(1),
      { kind: 'user', text: 'Turno 1', at: 't1' },
      { kind: 'text', blockId: 'b1', text: 'Resposta 1' },
    ];

    test('cuts before the checkpoint that precedes the target turn', () => {
      const result = truncateTranscriptAtTurn(withCheckpoints, 1);
      expect(result?.kept).toEqual(withCheckpoints.slice(0, 4));
      expect(result?.removedUserText).toBe('Turno 1');
      expect(result?.checkpointRef).toBe('refs/inova/checkpoints/s/1');
    });

    test('returns the large files the checkpoint skipped', () => {
      const events: ChatEvent[] = [
        {
          kind: 'checkpoint',
          turnId: 'u0',
          ref: 'refs/inova/checkpoints/s/0',
          createdAt: 't0',
          skippedLargeFiles: ['big.bin'],
        },
        { kind: 'user', text: 'Turno 0', at: 't0' },
      ];
      expect(truncateTranscriptAtTurn(events, 0)?.skippedLargeFiles).toEqual(['big.bin']);
      expect(truncateTranscriptAtTurn(withCheckpoints, 0)?.skippedLargeFiles).toEqual([]);
    });

    test('turn 0 keeps nothing', () => {
      const result = truncateTranscriptAtTurn(withCheckpoints, 0);
      expect(result?.kept).toEqual([]);
      expect(result?.removedUserText).toBe('Turno 0');
      expect(result?.checkpointRef).toBe('refs/inova/checkpoints/s/0');
    });

    test('cuts before the user event when no checkpoint precedes it', () => {
      const events: ChatEvent[] = [
        { kind: 'user', text: 'Turno 0', at: 't0' },
        { kind: 'done', isError: false, costUsd: null, durationMs: 1 },
        { kind: 'user', text: 'Turno 1', at: 't1' },
      ];
      const result = truncateTranscriptAtTurn(events, 1);
      expect(result?.kept).toEqual(events.slice(0, 2));
      expect(result?.checkpointRef).toBeNull();
    });

    test('keeps feedback of earlier turns recorded after the cut point', () => {
      const feedback = (turnIndex: number): ChatEvent => ({
        kind: 'feedback',
        turnIndex,
        value: 'up',
      });
      const events: ChatEvent[] = [
        { kind: 'user', text: 'Turno 0', at: 't0' },
        { kind: 'done', isError: false, costUsd: null, durationMs: 1 },
        { kind: 'user', text: 'Turno 1', at: 't1' },
        feedback(0),
        feedback(1),
        { kind: 'done', isError: false, costUsd: null, durationMs: 1 },
      ];
      const result = truncateTranscriptAtTurn(events, 1);
      expect(result?.kept).toEqual([...events.slice(0, 2), feedback(0)]);
    });

    test('returns null when the turn does not exist', () => {
      expect(truncateTranscriptAtTurn(withCheckpoints, 5)).toBeNull();
    });
  });

  describe('selectFailoverAccount', () => {
    const acc = (id: string, provider: ProviderId): Account => ({
      id,
      provider,
      label: id,
      homeDir: `/tmp/${id}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    test('returns null when policy is off', () => {
      const a1 = acc('a1', 'claude');
      const a2 = acc('a2', 'claude');
      expect(
        selectFailoverAccount({
          policy: 'off',
          currentAccountId: 'a1',
          currentProvider: 'claude',
          accounts: [a1, a2],
        }),
      ).toBeNull();
      expect(
        rankFailoverAccounts({
          policy: 'off',
          currentAccountId: 'a1',
          currentProvider: 'claude',
          accounts: [a1, a2],
        }),
      ).toEqual([]);
    });

    test('same-provider excludes cross-provider accounts', () => {
      const a1 = acc('a1', 'claude');
      const c1 = acc('c1', 'codex');
      const a2 = acc('a2', 'claude');
      expect(
        rankFailoverAccounts({
          policy: 'same-provider',
          currentAccountId: 'a1',
          currentProvider: 'claude',
          accounts: [a1, c1],
        }),
      ).toEqual([]);
      expect(
        selectFailoverAccount({
          policy: 'same-provider',
          currentAccountId: 'a1',
          currentProvider: 'claude',
          accounts: [a1, c1, a2],
        }),
      ).toEqual(a2);
    });

    test('any-provider ranks same provider, then primary providers, then others, idle before busy, then least-used', () => {
      const a1 = acc('a1', 'claude');
      const q1 = acc('q1', 'qwen');
      const cBusy = acc('c-busy', 'codex');
      const cHigh = acc('c-high', 'codex');
      const gLow = acc('g-low', 'gemini');
      const aBusy = acc('a-busy', 'claude');
      const usageByAccount = new Map<string, readonly UsageWindow[]>([
        ['c-high', [{ kind: 'session', usedPercent: 80, resetsAt: null }]],
        [
          'g-low',
          [
            { kind: 'session', usedPercent: 20, resetsAt: null },
            { kind: 'weekly', usedPercent: 35, resetsAt: null },
          ],
        ],
      ]);
      const ranked = rankFailoverAccounts({
        policy: 'any-provider',
        currentAccountId: 'a1',
        currentProvider: 'claude',
        accounts: [a1, q1, cBusy, cHigh, gLow, aBusy],
        busyAccountIds: new Set(['c-busy', 'a-busy']),
        usageByAccount,
      });
      expect(ranked.map((account) => account.id)).toEqual([
        'a-busy',
        'g-low',
        'c-high',
        'c-busy',
        'q1',
      ]);
      expect(peakUsagePercent(usageByAccount.get('g-low') ?? [])).toBe(35);
      expect(peakUsagePercent([])).toBe(0);
    });

    test('excludes exhausted, expired, and already tried accounts', () => {
      const accounts = [
        acc('a1', 'claude'),
        acc('a2', 'claude'),
        acc('a3', 'claude'),
        acc('a4', 'claude'),
        acc('a5', 'codex'),
      ];
      const chosen = selectFailoverAccount({
        policy: 'any-provider',
        currentAccountId: 'a1',
        currentProvider: 'claude',
        accounts,
        exhaustedAccountIds: new Set(['a2']),
        expiredAccountIds: new Set(['a3']),
        triedAccountIds: new Set(['a4']),
      });
      expect(chosen?.id).toBe('a5');
    });
  });

  describe('formatPinnedMemoryBlock and hashPinnedMemory', () => {
    test('returns null when both memories are empty or whitespace', () => {
      expect(formatPinnedMemoryBlock({})).toBeNull();
      expect(formatPinnedMemoryBlock({ projectMemory: '   ', sessionMemory: null })).toBeNull();
      expect(hashPinnedMemory(null)).toBeNull();
      expect(hashPinnedMemory('   ')).toBeNull();
    });

    test('formats project-only, session-only, and combined pinned memory sections', () => {
      const projectOnly = formatPinnedMemoryBlock({ projectMemory: '  Use pnpm  ' });
      expect(projectOnly).toContain('### Projeto\nUse pnpm');
      expect(projectOnly).not.toContain('### Sessão');

      const sessionOnly = formatPinnedMemoryBlock({ sessionMemory: 'Não alterar schema' });
      expect(sessionOnly).toContain('### Sessão\nNão alterar schema');
      expect(sessionOnly).not.toContain('### Projeto');

      const combined = formatPinnedMemoryBlock({
        projectMemory: 'Use pnpm',
        sessionMemory: 'Não alterar schema',
      });
      expect(combined).toContain('### Projeto\nUse pnpm\n\n### Sessão\nNão alterar schema');
      expect(hashPinnedMemory(combined)).not.toBe(hashPinnedMemory(projectOnly));
      expect(hashPinnedMemory(combined)).toBe(hashPinnedMemory(combined));
    });
  });

  describe('adversarial review helpers', () => {
    const acc = (id: string, provider: Account['provider']): Account => ({
      id,
      provider,
      label: id,
      homeDir: `/h/${id}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    test('selectReviewAccount prefers idle non-exhausted cross-provider account before same provider or fallback', () => {
      const a1 = acc('a1', 'claude');
      const a2 = acc('a2', 'claude');
      const gBusy = acc('g-busy', 'gemini');
      const cExhausted = acc('c-exh', 'codex');
      const cExpired = acc('c-exp', 'codex');
      const q1 = acc('q1', 'qwen');
      const gIdle = acc('g-idle', 'gemini');

      const chosen = selectReviewAccount({
        currentAccountId: 'a1',
        currentProvider: 'claude',
        accounts: [a1, a2, gBusy, cExhausted, cExpired, q1, gIdle],
        busyAccountIds: new Set(['g-busy']),
        exhaustedAccountIds: new Set(['c-exh']),
        expiredAccountIds: new Set(['c-exp']),
      });
      expect(chosen?.id).toBe('g-idle');

      const sameProviderFallback = selectReviewAccount({
        currentAccountId: 'a1',
        currentProvider: 'claude',
        accounts: [a1, a2, gBusy],
        busyAccountIds: new Set(['g-busy']),
      });
      expect(sameProviderFallback?.id).toBe('a2');

      const currentFallback = selectReviewAccount({
        currentAccountId: 'a1',
        currentProvider: 'claude',
        accounts: [a1, gBusy, cExhausted],
        busyAccountIds: new Set(['g-busy']),
        exhaustedAccountIds: new Set(['c-exh']),
      });
      expect(currentFallback?.id).toBe('a1');
    });

    test('buildAdversarialReviewPrompt and buildParentFixPrompt include branch, files, bounded diff, and findings', () => {
      const prompt = buildAdversarialReviewPrompt({
        branch: 'feat/x',
        changedFiles: ['src/a.ts', 'src/b.ts'],
        diffStat: '2 files changed',
        diff: 'x'.repeat(MAX_REVIEW_DIFF_CHARS + 50),
        maxDiffChars: 20,
      });
      expect(prompt).toContain('Branch: feat/x');
      expect(prompt).toContain('- src/a.ts');
      expect(prompt).toContain('- src/b.ts');
      expect(prompt).toContain('2 files changed');
      expect(prompt).toContain(`${'x'.repeat(19)}…`);

      const fixPrompt = buildParentFixPrompt('CRÍTICO: bug na linha 10');
      expect(fixPrompt).toContain('CRÍTICO: bug na linha 10');
      expect(fixPrompt).toContain('revisor independente');
    });
  });
});
