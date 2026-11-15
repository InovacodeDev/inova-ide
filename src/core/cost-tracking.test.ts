import { describe, expect, test } from 'vitest';
import type { ChatEvent } from './chat-types.js';
import {
  EMPTY_SESSION_USAGE_TOTALS,
  addTurnToUsageTotals,
  aggregateTranscriptUsage,
  extractTurnUsageFromLine,
  formatCostUsd,
  isSessionUsageTotals,
  sumSessionUsageTotals,
} from './cost-tracking.js';

describe('cost tracking helpers', () => {
  test('extractTurnUsageFromLine parses Claude, Codex, OpenCode, Gemini, and ignores non-completion lines', () => {
    expect(
      extractTurnUsageFromLine(
        JSON.stringify({
          type: 'result',
          parent_tool_use_id: null,
          total_cost_usd: 0.124,
          usage: {
            input_tokens: 20,
            cache_creation_input_tokens: 1000,
            cache_read_input_tokens: 5000,
            output_tokens: 150,
          },
        }),
      ),
    ).toEqual({
      inputTokens: 20,
      outputTokens: 150,
      cacheReadTokens: 5000,
      cacheWriteTokens: 1000,
    });

    expect(
      extractTurnUsageFromLine(
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 24763, cached_input_tokens: 24448, output_tokens: 122 },
        }),
      ),
    ).toEqual({
      inputTokens: 315,
      outputTokens: 122,
      cacheReadTokens: 24448,
      cacheWriteTokens: 0,
    });

    expect(
      extractTurnUsageFromLine(
        JSON.stringify({
          type: 'step_finish',
          part: {
            reason: 'stop',
            cost: 0.02,
            tokens: { input: 300, output: 80, cache: { read: 90, write: 10 } },
          },
        }),
      ),
    ).toEqual({
      inputTokens: 300,
      outputTokens: 80,
      cacheReadTokens: 90,
      cacheWriteTokens: 10,
    });

    expect(
      extractTurnUsageFromLine(
        JSON.stringify({
          event: 'result',
          result: {
            status: 'SUCCESS',
            stats: { input_tokens: 400, output_tokens: 50, cached_tokens: 120 },
          },
        }),
      ),
    ).toEqual({
      inputTokens: 280,
      outputTokens: 50,
      cacheReadTokens: 120,
      cacheWriteTokens: 0,
    });

    expect(
      extractTurnUsageFromLine(
        JSON.stringify({
          type: 'result',
          usage: {
            prompt_tokens: 500,
            completion_tokens: 40,
            prompt_tokens_details: { cached_tokens: 300 },
          },
        }),
      ),
    ).toEqual({
      inputTokens: 200,
      outputTokens: 40,
      cacheReadTokens: 300,
      cacheWriteTokens: 0,
    });

    expect(extractTurnUsageFromLine('not json')).toBeNull();
    expect(
      extractTurnUsageFromLine(JSON.stringify({ type: 'assistant', usage: { input_tokens: 10 } })),
    ).toBeNull();
    expect(
      extractTurnUsageFromLine(
        JSON.stringify({
          type: 'result',
          parent_tool_use_id: 'tool-1',
          usage: { input_tokens: 10 },
        }),
      ),
    ).toBeNull();
  });

  test('aggregateTranscriptUsage, addTurnToUsageTotals, sumSessionUsageTotals, and formatCostUsd compute exact totals', () => {
    const events: ChatEvent[] = [
      { kind: 'user', text: 'Implemente a feature A', at: '2026-01-01T00:00:00.000Z' },
      {
        kind: 'turn-usage',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 400,
        cacheWriteTokens: 200,
      },
      { kind: 'done', isError: false, costUsd: 0.111111, durationMs: 1200 },
      { kind: 'user', text: 'Rode os testes', at: '2026-01-01T00:01:00.000Z' },
      {
        kind: 'turn-usage',
        inputTokens: 80,
        outputTokens: 20,
        cacheReadTokens: 600,
        cacheWriteTokens: 0,
      },
      { kind: 'done', isError: false, costUsd: null, durationMs: 800 },
    ];

    const { totals, turnEntries } = aggregateTranscriptUsage(events);
    expect(totals).toEqual({
      costUsd: 0.111111,
      costTurns: 1,
      turns: 2,
      durationMs: 2000,
      inputTokens: 180,
      outputTokens: 70,
      cacheReadTokens: 1000,
      cacheWriteTokens: 200,
    });
    expect(turnEntries).toEqual([
      {
        turnIndex: 0,
        promptPreview: 'Implemente a feature A',
        isError: false,
        costUsd: 0.111111,
        durationMs: 1200,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 400,
        cacheWriteTokens: 200,
      },
      {
        turnIndex: 1,
        promptPreview: 'Rode os testes',
        isError: false,
        costUsd: null,
        durationMs: 800,
        inputTokens: 80,
        outputTokens: 20,
        cacheReadTokens: 600,
        cacheWriteTokens: 0,
      },
    ]);

    const incremented = addTurnToUsageTotals(EMPTY_SESSION_USAGE_TOTALS, {
      costUsd: 0.222222,
      durationMs: 500,
    });
    const combined = sumSessionUsageTotals([totals, incremented, null, undefined]);
    expect(combined.costUsd).toBe(0.333333);
    expect(combined.costTurns).toBe(2);
    expect(combined.turns).toBe(3);
    expect(combined.durationMs).toBe(2500);
    expect(isSessionUsageTotals(combined)).toBe(true);
    expect(isSessionUsageTotals({ ...combined, turns: -1 })).toBe(false);
    expect(formatCostUsd(0.123456)).toBe('$0.1235');
    expect(formatCostUsd(null)).toBe('—');
  });
});
