import { describe, expect, test } from 'vitest';
import type { ChatItem } from '../src/renderer/chat-reducer';
import { STATUS_LABEL, sessionStatus } from '../src/renderer/session-status';

const assistant: ChatItem = { type: 'assistant', id: 'a', text: 'ok', streaming: false };
const failure: ChatItem = { type: 'error', id: 'e', message: 'falhou' };

describe('sessionStatus', () => {
  test('returns idle for undefined state', () => {
    expect(sessionStatus(undefined)).toBe('idle');
  });

  test('returns idle when there are no items and nothing runs', () => {
    expect(sessionStatus({ items: [], running: false })).toBe('idle');
  });

  test('returns running while a turn runs, even without items', () => {
    expect(sessionStatus({ items: [], running: true })).toBe('running');
    expect(sessionStatus({ items: [failure], running: true })).toBe('running');
  });

  test('returns error when the last item is an error', () => {
    expect(sessionStatus({ items: [assistant, failure], running: false })).toBe('error');
  });

  test('returns idle when the last item is a user message and nothing runs', () => {
    const userMessage: ChatItem = { type: 'user', id: 'u', text: 'oi', at: null };
    expect(sessionStatus({ items: [assistant, userMessage], running: false })).toBe('idle');
  });

  test('returns done otherwise', () => {
    expect(sessionStatus({ items: [failure, assistant], running: false })).toBe('done');
  });
});

describe('STATUS_LABEL', () => {
  test('labels every status in Portuguese', () => {
    expect(STATUS_LABEL).toEqual({
      running: 'Executando',
      done: 'Concluída',
      error: 'Erro',
      idle: 'Ociosa',
    });
  });
});
