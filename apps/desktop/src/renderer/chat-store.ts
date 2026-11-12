import { chatReducer, initialChatState, type ChatAction, type ChatState } from './chat-reducer';

export type ChatStore = Record<string, ChatState>;

export interface ChatStoreAction {
  sessionId: string;
  action: ChatAction;
}

export function chatStoreReducer(
  store: ChatStore,
  { sessionId, action }: ChatStoreAction,
): ChatStore {
  return { ...store, [sessionId]: chatReducer(store[sessionId] ?? initialChatState, action) };
}
