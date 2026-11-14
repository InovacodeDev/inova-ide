import { describe, expect, test } from 'vitest';
import type { ChatEvent } from './chat-types.js';
import {
  buildHandoffContext,
  isRateLimitMessage,
  sliceTranscriptToTurn,
  truncateTranscriptAtTurn,
} from './handoff.js';

describe('handoff', () => {
  test('isRateLimitMessage detects common quota and 429 errors', () => {
    expect(isRateLimitMessage('HTTP 429: rate limit exceeded')).toBe(true);
    expect(isRateLimitMessage('You reached your weekly usage limit')).toBe(true);
    expect(isRateLimitMessage('Insufficient quota on this account')).toBe(true);
    expect(isRateLimitMessage('SyntaxError: unexpected token')).toBe(false);
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
});
