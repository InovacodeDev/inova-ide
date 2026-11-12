import { describe, expect, test } from 'vitest';
import { chatStoreReducer, type ChatStore } from '../src/renderer/chat-store';

const AT = '2026-01-01T00:00:00.000Z';

describe('chatStoreReducer', () => {
  test('creates state for an unknown session on first action', () => {
    const store = chatStoreReducer({}, { sessionId: 'a', action: { type: 'started' } });
    expect(store['a']?.running).toBe(true);
  });

  test('routes actions only to the target session', () => {
    const start: ChatStore = chatStoreReducer({}, { sessionId: 'a', action: { type: 'started' } });
    const store = chatStoreReducer(start, {
      sessionId: 'b',
      action: { type: 'event', event: { kind: 'user', text: 'oi', at: AT } },
    });
    expect(store['a']?.running).toBe(true);
    expect(store['a']?.items).toEqual([]);
    expect(store['b']?.items).toHaveLength(1);
  });

  test('load replaces the session state with the transcript', () => {
    const start = chatStoreReducer({}, { sessionId: 'a', action: { type: 'started' } });
    const store = chatStoreReducer(start, {
      sessionId: 'a',
      action: { type: 'load', events: [{ kind: 'user', text: 'oi', at: AT }] },
    });
    expect(store['a']?.running).toBe(false);
    expect(store['a']?.items).toHaveLength(1);
  });
});
