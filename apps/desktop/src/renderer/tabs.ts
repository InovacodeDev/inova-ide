import type { ProviderId } from '@inova/core/types';

export interface Tab {
  sessionId: string;
  title: string;
  exited: boolean;
  kind: 'chat';
  provider: ProviderId | null;
}

export interface TabsState {
  tabs: Tab[];
  active: string | null;
}

export type TabsAction =
  | { type: 'open'; tab: Pick<Tab, 'sessionId' | 'title' | 'kind' | 'provider'> }
  | { type: 'close'; sessionId: string }
  | { type: 'activate'; sessionId: string }
  | { type: 'exited'; sessionId: string }
  | { type: 'rename'; sessionId: string; title: string };

function closeTab(state: TabsState, sessionId: string): TabsState {
  const index = state.tabs.findIndex((tab) => tab.sessionId === sessionId);
  const tabs = state.tabs.filter((tab) => tab.sessionId !== sessionId);
  if (state.active !== sessionId) return { ...state, tabs };
  const neighbor = tabs[index - 1] ?? tabs[index] ?? null;
  return { tabs, active: neighbor?.sessionId ?? null };
}

function updateTab(state: TabsState, sessionId: string, patch: Partial<Tab>): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.sessionId === sessionId ? { ...tab, ...patch } : tab)),
  };
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  if (action.type === 'open') {
    const { sessionId } = action.tab;
    if (state.tabs.some((tab) => tab.sessionId === sessionId)) {
      return { ...state, active: sessionId };
    }
    return { tabs: [...state.tabs, { ...action.tab, exited: false }], active: sessionId };
  }
  if (!state.tabs.some((tab) => tab.sessionId === action.sessionId)) return state;
  switch (action.type) {
    case 'close':
      return closeTab(state, action.sessionId);
    case 'activate':
      return { ...state, active: action.sessionId };
    case 'exited':
      return updateTab(state, action.sessionId, { exited: true });
    case 'rename':
      return updateTab(state, action.sessionId, { title: action.title });
  }
}
