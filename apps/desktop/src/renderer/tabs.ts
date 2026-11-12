import type { OpenedSession } from '../shared/api';

export interface Tab {
  sessionId: string;
  title: string;
  exited: boolean;
}

export interface TabsState {
  tabs: Tab[];
  active: string | null;
}

export type TabsAction =
  | { type: 'open'; tab: OpenedSession }
  | { type: 'close'; sessionId: string }
  | { type: 'activate'; sessionId: string }
  | { type: 'exited'; sessionId: string };

function closeTab(state: TabsState, sessionId: string): TabsState {
  const index = state.tabs.findIndex((tab) => tab.sessionId === sessionId);
  const tabs = state.tabs.filter((tab) => tab.sessionId !== sessionId);
  if (state.active !== sessionId) return { ...state, tabs };
  const neighbor = tabs[index - 1] ?? tabs[index] ?? null;
  return { tabs, active: neighbor?.sessionId ?? null };
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  if (action.type === 'open') {
    const tab: Tab = { sessionId: action.tab.sessionId, title: action.tab.title, exited: false };
    return { tabs: [...state.tabs, tab], active: tab.sessionId };
  }
  if (!state.tabs.some((tab) => tab.sessionId === action.sessionId)) return state;
  switch (action.type) {
    case 'close':
      return closeTab(state, action.sessionId);
    case 'activate':
      return { ...state, active: action.sessionId };
    case 'exited':
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.sessionId === action.sessionId ? { ...tab, exited: true } : tab,
        ),
      };
  }
}
