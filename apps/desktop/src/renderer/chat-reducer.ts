import type { ChatEvent, SubagentSnapshot, VerificationCheckResult } from '@inova/core/chat-types';

export type ChatItem =
  | { type: 'user'; id: string; text: string; at: string | null }
  | { type: 'assistant'; id: string; text: string; streaming: boolean }
  | {
      type: 'tool';
      id: string;
      name: string;
      input: string;
      output: string | null;
      isError: boolean;
    }
  | {
      type: 'checkpoint';
      id: string;
      turnId: string;
      ref: string;
      createdAt: string;
      skippedLargeFiles: string[];
    }
  | {
      type: 'verification';
      id: string;
      turnId: string;
      status: 'running' | 'passed' | 'failed' | 'skipped';
      checks: VerificationCheckResult[];
    }
  | { type: 'error'; id: string; message: string };

export interface ContextInfo {
  usedTokens: number;
  windowTokens: number | null;
  model: string | null;
}

export interface ChatState {
  items: ChatItem[];
  running: boolean;
  subagents?: SubagentSnapshot[];
  context?: ContextInfo;
}

const INTERRUPTED_MESSAGE = 'Turno interrompido ao fechar o app.';

export const initialChatState: ChatState = { items: [], running: false };

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

function upsertVerification(
  items: ChatItem[],
  event: Extract<ChatEvent, { kind: 'verification' }>,
): ChatItem[] {
  const index = items.findIndex(
    (item) => item.type === 'verification' && item.turnId === event.turnId,
  );
  const nextItem: Extract<ChatItem, { type: 'verification' }> = {
    type: 'verification',
    id: `verification-${event.turnId}`,
    turnId: event.turnId,
    status: event.status,
    checks: event.checks,
  };
  if (index === -1) return [...items, nextItem];
  const next = items.slice();
  next[index] = nextItem;
  return next;
}

function upsertSubagent(
  subagents: SubagentSnapshot[],
  event: Extract<ChatEvent, { kind: 'subagent' }>,
): SubagentSnapshot[] {
  const { kind: _kind, ...snapshot } = event;
  const index = subagents.findIndex((item) => item.toolId === snapshot.toolId);
  if (index === -1) return [...subagents, snapshot];
  const next = subagents.slice();
  next[index] = snapshot;
  return next;
}

function applyEvent(state: ChatState, event: ChatEvent): ChatState {
  const { items } = state;
  switch (event.kind) {
    case 'user': {
      const { subagents: _previous, ...rest } = state;
      return {
        ...rest,
        items: [
          ...items,
          { type: 'user', id: `user-${items.length}`, text: event.text, at: event.at },
        ],
      };
    }
    case 'subagent':
      return { ...state, subagents: upsertSubagent(state.subagents ?? [], event) };
    case 'context':
      return {
        ...state,
        context: {
          usedTokens: event.usedTokens,
          windowTokens: event.windowTokens,
          model: event.model,
        },
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
    case 'checkpoint':
      return {
        ...state,
        items: [
          ...items,
          {
            type: 'checkpoint',
            id: `checkpoint-${event.turnId}`,
            turnId: event.turnId,
            ref: event.ref,
            createdAt: event.createdAt,
            skippedLargeFiles: event.skippedLargeFiles,
          },
        ],
      };
    case 'verification':
      return {
        ...state,
        items: upsertVerification(items, event),
      };
    case 'error':
      return {
        ...state,
        items: [...items, { type: 'error', id: `error-${items.length}`, message: event.message }],
      };
    case 'done': {
      const closed = {
        ...state,
        items: items.map((item) =>
          item.type === 'assistant' && item.streaming ? { ...item, streaming: false } : item,
        ),
        running: false,
      };
      if (state.subagents === undefined) return closed;
      return {
        ...closed,
        subagents: state.subagents.map((item) =>
          item.status === 'running' ? { ...item, status: 'done' } : item,
        ),
      };
    }
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
      if (state.running || state.items.length > 0) return state;
      return loadTranscript(action.events);
  }
}

function loadTranscript(events: ChatEvent[]): ChatState {
  const replayed = { ...events.reduce(applyEvent, initialChatState), running: false };
  const kinds = events.map((event) => event.kind);
  const lastUser = kinds.lastIndexOf('user');
  const lastDone = kinds.lastIndexOf('done');
  if (lastUser <= lastDone) return replayed;
  return {
    ...replayed,
    items: [
      ...replayed.items.map((item) =>
        item.type === 'assistant' && item.streaming ? { ...item, streaming: false } : item,
      ),
      { type: 'error', id: 'interrupted', message: INTERRUPTED_MESSAGE },
    ],
  };
}
