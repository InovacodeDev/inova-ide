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
      { kind: 'user', text: 'oi', at: 'now' },
      { kind: 'error', message: 'falhou' },
    ]);
    expect(state.items).toEqual([
      { type: 'user', id: 'user-0', text: 'oi' },
      { type: 'error', id: 'error-1', message: 'falhou' },
    ]);
  });

  test('started sets running; done clears it, stops streaming and adds cost', () => {
    const started = chatReducer(initialChatState, { type: 'started' });
    expect(started.running).toBe(true);
    const streaming = run([{ kind: 'text-delta', blockId: 'b1', text: 'a' }], started);
    const first = run([{ kind: 'done', isError: false, costUsd: 0.5, durationMs: 1 }], streaming);
    expect(first.running).toBe(false);
    expect(first.items).toEqual([{ type: 'assistant', id: 'b1', text: 'a', streaming: false }]);
    expect(first.costUsd).toBe(0.5);
    const second = run([{ kind: 'done', isError: false, costUsd: 0.25, durationMs: null }], first);
    expect(second.costUsd).toBe(0.75);
  });

  test('session and usage-limits do not change items', () => {
    const state = run([
      { kind: 'session', providerSessionId: 's' },
      { kind: 'usage-limits', windows: [] },
    ]);
    expect(state.items).toEqual([]);
  });

  test('load replays events from scratch and ends not running', () => {
    const dirty = chatReducer(initialChatState, { type: 'started' });
    const action: ChatAction = {
      type: 'load',
      events: [
        { kind: 'user', text: 'oi', at: 'now' },
        { kind: 'text', blockId: 'b1', text: 'olá' },
      ],
    };
    const state = chatReducer(dirty, action);
    expect(state.running).toBe(false);
    expect(state.items).toHaveLength(2);
  });
});
