import type { InboxItem } from '@inova/core/types';

export type InboxFilter = 'all' | 'failed' | 'waiting';

export function upsertInboxItem(items: readonly InboxItem[], incoming: InboxItem): InboxItem[] {
  const next = items.filter((item) => item.sessionId !== incoming.sessionId);
  next.push(incoming);
  return next.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function markInboxRead(items: readonly InboxItem[], sessionId: string): InboxItem[] {
  return items.map((item) => (item.sessionId === sessionId ? { ...item, unread: false } : item));
}

export function clearReadInbox(items: readonly InboxItem[]): InboxItem[] {
  return items.filter((item) => item.unread);
}

export function filterInbox(items: readonly InboxItem[], filter: InboxFilter): InboxItem[] {
  switch (filter) {
    case 'all':
      return [...items];
    case 'failed':
      return items.filter((item) => item.kind === 'failed');
    case 'waiting':
      return items.filter((item) => item.kind === 'waiting-input');
  }
}

export function unreadInboxCount(items: readonly InboxItem[]): number {
  return items.filter((item) => item.unread).length;
}

export function shouldNotifyCompleted(input: {
  sessionId: string;
  activeSessionId: string | null;
  windowFocused: boolean;
}): boolean {
  if (!input.windowFocused) return true;
  return input.sessionId !== input.activeSessionId;
}
