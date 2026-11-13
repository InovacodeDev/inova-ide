import { describe, expect, test } from 'vitest';
import type { InboxItem } from '@inova/core/types';
import {
  clearReadInbox,
  filterInbox,
  markInboxRead,
  shouldNotifyCompleted,
  unreadInboxCount,
  upsertInboxItem,
} from '../src/renderer/inbox-state.js';

function makeItem(overrides: Partial<InboxItem>): InboxItem {
  return {
    sessionId: 's1',
    projectId: 'p1',
    sessionTitle: 'Sessão 1',
    projectName: 'repo',
    provider: 'claude',
    kind: 'completed',
    summary: 'Turno concluído',
    at: '2026-11-13T01:00:00.000Z',
    unread: true,
    ...overrides,
  };
}

describe('inbox-state', () => {
  test('upserts newest-first, marks read, filters, and clears read items', () => {
    let items: InboxItem[] = [];
    items = upsertInboxItem(items, makeItem({ sessionId: 's1', at: '2026-11-13T01:00:00Z' }));
    items = upsertInboxItem(
      items,
      makeItem({ sessionId: 's2', kind: 'failed', at: '2026-11-13T02:00:00Z' }),
    );
    items = upsertInboxItem(
      items,
      makeItem({ sessionId: 's3', kind: 'waiting-input', at: '2026-11-13T01:30:00Z' }),
    );

    expect(items.map((item) => item.sessionId)).toEqual(['s2', 's3', 's1']);
    expect(unreadInboxCount(items)).toBe(3);
    expect(filterInbox(items, 'failed').map((item) => item.sessionId)).toEqual(['s2']);
    expect(filterInbox(items, 'waiting').map((item) => item.sessionId)).toEqual(['s3']);

    items = markInboxRead(items, 's1');
    expect(unreadInboxCount(items)).toBe(2);

    items = clearReadInbox(items);
    expect(items.map((item) => item.sessionId)).toEqual(['s2', 's3']);
  });

  test('suppresses completed attention only when session is active visible and window focused', () => {
    expect(
      shouldNotifyCompleted({ sessionId: 's1', activeSessionId: 's1', windowFocused: true }),
    ).toBe(false);
    expect(
      shouldNotifyCompleted({ sessionId: 's1', activeSessionId: 's1', windowFocused: false }),
    ).toBe(true);
    expect(
      shouldNotifyCompleted({ sessionId: 's1', activeSessionId: 's2', windowFocused: true }),
    ).toBe(true);
  });
});
