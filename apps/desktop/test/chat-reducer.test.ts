import { describe, expect, test } from 'vitest';
import type { ChatEvent } from '@inova/core/chat-types';
import {
  chatReducer,
  initialChatState,
  type ChatAction,
  type ChatState,
} from '../src/renderer/chat-reducer';

const run = (events: ChatEvent[], from: ChatState = initialChatState): ChatState =>
  events.reduce<ChatState>((state, event) => chatReducer(state, { type: 'event', event }), from);

describe('chatReducer', () => {
  test('text-delta creates a streaming assistant item and accumulates', () => {
    const state = run([
      { kind: 'text-delta', blockId: 'b1', text: 'Ol' },
      { kind: 'text-delta', blockId: 'b1', text: 'á' },
    ]);
    expect(state.items).toEqual([{ type: 'assistant', id: 'b1', text: 'Olá', streaming: true }]);
  });

  test('text replaces accumulated deltas and stops streaming', () => {
    const state = run([
      { kind: 'text-delta', blockId: 'b1', text: 'parcial' },
      { kind: 'text', blockId: 'b1', text: 'final' },
    ]);
    expect(state.items).toEqual([{ type: 'assistant', id: 'b1', text: 'final', streaming: false }]);
  });

  test('text without prior deltas creates the item', () => {
    const state = run([{ kind: 'text', blockId: 'b2', text: 'x' }]);
    expect(state.items).toEqual([{ type: 'assistant', id: 'b2', text: 'x', streaming: false }]);
  });

  test('tool-result fills the matching tool and ignores unknown ids', () => {
    const state = run([
      { kind: 'tool-use', toolId: 't1', name: 'Bash', input: 'ls' },
      { kind: 'tool-result', toolId: 't1', output: 'negado', isError: true },
      { kind: 'tool-result', toolId: 'missing', output: 'x', isError: false },
    ]);
    expect(state.items).toEqual([
      { type: 'tool', id: 't1', name: 'Bash', input: 'ls', output: 'negado', isError: true },
    ]);
  });

  test('user and error events add items with index-based ids', () => {
    const state = run([
      { kind: 'user', text: 'oi', at: '2026-11-13T14:30:00' },
      { kind: 'error', message: 'falhou' },
    ]);
    expect(state.items).toEqual([
      { type: 'user', id: 'user-0', text: 'oi', at: '2026-11-13T14:30:00' },
      { type: 'error', id: 'error-1', message: 'falhou' },
    ]);
  });

  test('started sets running; done clears it and stops streaming', () => {
    const started = chatReducer(initialChatState, { type: 'started' });
    expect(started.running).toBe(true);
    const streaming = run([{ kind: 'text-delta', blockId: 'b1', text: 'a' }], started);
    const done = run([{ kind: 'done', isError: false, costUsd: 0.5, durationMs: 1 }], streaming);
    expect(done).toEqual({
      running: false,
      items: [{ type: 'assistant', id: 'b1', text: 'a', streaming: false }],
    });
  });

  const agent: ChatEvent = {
    kind: 'subagent',
    toolId: 'tu1',
    description: 'Explorar',
    agentType: 'Explore',
    model: 'haiku',
    status: 'running',
    inputTokens: 10,
    outputTokens: 2,
    totalTokens: 12,
  };

  test('subagent events upsert by tool id without adding chat items', () => {
    const state = run([
      agent,
      { ...agent, toolId: 'tu2', description: 'Outro' },
      { ...agent, status: 'done', totalTokens: 99 },
    ]);
    expect(state.items).toEqual([]);
    expect(state.subagents?.map((item) => [item.toolId, item.status, item.totalTokens])).toEqual([
      ['tu1', 'done', 99],
      ['tu2', 'running', 12],
    ]);
  });

  test('context event keeps the latest value and survives done', () => {
    const state = run([
      { kind: 'context', usedTokens: 1, windowTokens: 200_000, model: 'm' },
      { kind: 'context', usedTokens: 5, windowTokens: 200_000, model: 'm' },
      { kind: 'done', isError: false, costUsd: null, durationMs: null },
    ]);
    expect(state.context).toEqual({ usedTokens: 5, windowTokens: 200_000, model: 'm' });
  });

  test('done closes running subagents and a new user turn clears them', () => {
    const finished = run([
      agent,
      { kind: 'done', isError: false, costUsd: null, durationMs: null },
    ]);
    expect(finished.subagents?.[0]?.status).toBe('done');
    const next = run([{ kind: 'user', text: 'oi', at: 'now' }], finished);
    expect(next.subagents).toBeUndefined();
  });

  test('replaying a transcript rebuilds subagents and context', () => {
    const state = chatReducer(initialChatState, {
      type: 'load',
      events: [
        { kind: 'user', text: 'oi', at: 'now' },
        agent,
        { kind: 'context', usedTokens: 7, windowTokens: null, model: null },
        { kind: 'done', isError: false, costUsd: null, durationMs: null },
      ],
    });
    expect(state.subagents?.[0]?.toolId).toBe('tu1');
    expect(state.context?.usedTokens).toBe(7);
  });

  test('session and usage-limits do not change items', () => {
    const state = run([
      { kind: 'session', providerSessionId: 's' },
      { kind: 'usage-limits', windows: [] },
    ]);
    expect(state.items).toEqual([]);
  });

  const loadAction: ChatAction = {
    type: 'load',
    events: [
      { kind: 'user', text: 'oi', at: 'now' },
      { kind: 'text', blockId: 'b1', text: 'olá' },
      { kind: 'done', isError: false, costUsd: null, durationMs: null },
    ],
  };

  test('load replays events into an empty idle state', () => {
    const state = chatReducer(initialChatState, loadAction);
    expect(state.running).toBe(false);
    expect(state.items).toHaveLength(2);
  });

  test('load marks a trailing user turn without done as interrupted', () => {
    const state = chatReducer(initialChatState, {
      type: 'load',
      events: [
        { kind: 'user', text: 'a', at: 'now' },
        { kind: 'done', isError: false, costUsd: null, durationMs: null },
        { kind: 'user', text: 'b', at: 'now' },
        { kind: 'text', blockId: 'b1', text: 'parcial' },
      ],
    });
    expect(state.running).toBe(false);
    expect(state.items.at(-1)).toMatchObject({
      type: 'error',
      message: 'Turno interrompido ao fechar o app.',
    });
  });

  test('load does not flag a completed turn', () => {
    const state = chatReducer(initialChatState, {
      type: 'load',
      events: [
        { kind: 'user', text: 'a', at: 'now' },
        { kind: 'done', isError: false, costUsd: null, durationMs: null },
      ],
    });
    expect(state.items.some((item) => item.type === 'error')).toBe(false);
  });

  test('load is ignored while a turn is running', () => {
    const running = chatReducer(initialChatState, { type: 'started' });
    expect(chatReducer(running, loadAction)).toBe(running);
  });

  test('feedback keeps the last value per turn and null removes the key', () => {
    const base: ChatEvent[] = [
      { kind: 'user', text: 'a', at: 'now' },
      { kind: 'feedback', turnIndex: 0, value: 'up' },
      { kind: 'feedback', turnIndex: 1, value: 'down' },
      { kind: 'feedback', turnIndex: 0, value: 'down' },
    ];
    expect(run(base).feedback).toEqual({ 0: 'down', 1: 'down' });
    const cleared = run([...base, { kind: 'feedback', turnIndex: 1, value: null }]);
    expect(cleared.feedback).toEqual({ 0: 'down' });
    expect(cleared.items).toHaveLength(1);
  });

  test('load rebuilds the feedback map from the transcript', () => {
    const state = chatReducer(initialChatState, {
      type: 'load',
      events: [
        { kind: 'user', text: 'a', at: 'now' },
        { kind: 'done', isError: false, costUsd: null, durationMs: null },
        { kind: 'feedback', turnIndex: 0, value: 'up' },
      ],
    });
    expect(state.feedback).toEqual({ 0: 'up' });
  });

  test('replace swaps the items for the reloaded transcript but not while running', () => {
    const live = run([
      { kind: 'user', text: 'velho', at: 'now' },
      { kind: 'feedback', turnIndex: 0, value: 'up' },
    ]);
    const replaced = chatReducer(live, { type: 'replace', events: loadAction.events });
    expect(replaced.items).toHaveLength(2);
    expect(replaced.feedback).toBeUndefined();
    const running = chatReducer(initialChatState, { type: 'started' });
    expect(chatReducer(running, { type: 'replace', events: loadAction.events })).toBe(running);
  });

  test('load is ignored when the state already has items', () => {
    const live = run([{ kind: 'user', text: 'novo', at: 'now' }]);
    expect(chatReducer(live, loadAction)).toBe(live);
  });

  test('tracks checkpoint and upserts verification events by turnId', () => {
    const next = run([
      { kind: 'user', text: 'corrija', at: 'now' },
      {
        kind: 'checkpoint',
        turnId: 't1',
        ref: 'refs/inova/checkpoints/s1/t1',
        createdAt: 'now',
        skippedLargeFiles: [],
      },
      { kind: 'verification', turnId: 't1', status: 'running', checks: [] },
      {
        kind: 'verification',
        turnId: 't1',
        status: 'failed',
        checks: [
          {
            id: 'lint',
            label: 'Lint',
            command: 'pnpm lint',
            passed: false,
            exitCode: 1,
            timedOut: false,
            durationMs: 50,
            output: 'err',
          },
        ],
      },
    ]);
    expect(next.items.some((item) => item.type === 'checkpoint')).toBe(true);
    const verifs = next.items.filter((item) => item.type === 'verification');
    expect(verifs).toHaveLength(1);
    expect(verifs[0]).toMatchObject({ status: 'failed', turnId: 't1' });
  });
});
