import { chatReducer, initialChatState, type ChatAction, type ChatState } from './chat-reducer';

export type ChatStore = Record<string, ChatState>;

export type ChatStoreAction =
  { sessionId: string; action: ChatAction } | { type: 'drop'; sessionIds: string[] };

export function chatStoreReducer(store: ChatStore, input: ChatStoreAction): ChatStore {
  if ('type' in input) {
    const dropped = new Set(input.sessionIds);
    return Object.fromEntries(Object.entries(store).filter(([id]) => !dropped.has(id)));
  }
  const { sessionId, action } = input;
  return { ...store, [sessionId]: chatReducer(store[sessionId] ?? initialChatState, action) };
}
