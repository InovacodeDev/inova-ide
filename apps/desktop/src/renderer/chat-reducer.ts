import type { ChatEvent } from '@inova/core/chat-types';

export type ChatItem =
  | { type: 'user'; id: string; text: string }
  | { type: 'assistant'; id: string; text: string; streaming: boolean }
  | {
      type: 'tool';
      id: string;
      name: string;
      input: string;
      output: string | null;
      isError: boolean;
    }
  | { type: 'error'; id: string; message: string };

export interface ChatState {
  items: ChatItem[];
  running: boolean;
  costUsd: number | null;
}

export const initialChatState: ChatState = { items: [], running: false, costUsd: null };

export type ChatAction =
  { type: 'event'; event: ChatEvent } | { type: 'load'; events: ChatEvent[] } | { type: 'started' };

function upsertAssistant(
  items: ChatItem[],
  update: { blockId: string; text: string; append: boolean },
): ChatItem[] {
  const index = items.findIndex((item) => item.type === 'assistant' && item.id === update.blockId);
  const existing = items[index];
  if (existing?.type !== 'assistant') {
    return [
      ...items,
      { type: 'assistant', id: update.blockId, text: update.text, streaming: update.append },
    ];
  }
  const next = items.slice();
  next[index] = {
    ...existing,
    text: update.append ? existing.text + update.text : update.text,
    streaming: update.append,
  };
  return next;
}

function applyEvent(state: ChatState, event: ChatEvent): ChatState {
  const { items } = state;
  switch (event.kind) {
    case 'user':
      return {
        ...state,
        items: [...items, { type: 'user', id: `user-${items.length}`, text: event.text }],
      };
    case 'text-delta':
      return {
        ...state,
        items: upsertAssistant(items, { blockId: event.blockId, text: event.text, append: true }),
      };
    case 'text':
      return {
        ...state,
        items: upsertAssistant(items, { blockId: event.blockId, text: event.text, append: false }),
      };
    case 'tool-use':
      return {
        ...state,
        items: [
          ...items,
          {
            type: 'tool',
            id: event.toolId,
            name: event.name,
            input: event.input,
            output: null,
            isError: false,
          },
        ],
      };
    case 'tool-result':
      return {
        ...state,
        items: items.map((item) =>
          item.type === 'tool' && item.id === event.toolId
            ? { ...item, output: event.output, isError: event.isError }
            : item,
        ),
      };
    case 'error':
      return {
        ...state,
        items: [...items, { type: 'error', id: `error-${items.length}`, message: event.message }],
      };
    case 'done':
      return {
        items: items.map((item) =>
          item.type === 'assistant' && item.streaming ? { ...item, streaming: false } : item,
        ),
        running: false,
        costUsd: event.costUsd === null ? state.costUsd : (state.costUsd ?? 0) + event.costUsd,
      };
    case 'session':
    case 'usage-limits':
      return state;
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'started':
      return { ...state, running: true };
    case 'event':
      return applyEvent(state, action.event);
    case 'load':
      return {
        ...action.events.reduce(applyEvent, initialChatState),
        running: false,
      };
  }
}
