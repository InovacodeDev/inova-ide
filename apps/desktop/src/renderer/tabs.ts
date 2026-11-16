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
  split: [string, string] | null;
}

export type TabsAction =
  | { type: 'open'; tab: Pick<Tab, 'sessionId' | 'title' | 'kind' | 'provider'> }
  | { type: 'close'; sessionId: string }
  | { type: 'activate'; sessionId: string }
  | { type: 'exited'; sessionId: string }
  | { type: 'rename'; sessionId: string; title: string }
  | { type: 'rebind'; sessionId: string; provider: ProviderId | null }
  | { type: 'split'; sessionId: string }
  | { type: 'unsplit'; sessionId: string }
  | { type: 'move'; sessionId: string; toIndex: number };

export const initialTabsState: TabsState = { tabs: [], active: null, split: null };

export function visibleSessionIds(state: TabsState): string[] {
  if (state.split) return [...state.split];
  return state.active === null ? [] : [state.active];
}

function focusPane(state: TabsState, sessionId: string): TabsState {
  const { split, active } = state;
  if (!split || split.includes(sessionId)) return { ...state, active: sessionId };
  const focusedIndex = split.indexOf(active ?? '');
  const paneIndex = focusedIndex === -1 ? 0 : focusedIndex;
  const panes: [string, string] = paneIndex === 0 ? [sessionId, split[1]] : [split[0], sessionId];
  return { ...state, active: sessionId, split: panes };
}

function openSplit(state: TabsState, sessionId: string): TabsState {
  const { split, active } = state;
  if (active === null || active === sessionId) return state;
  if (!split) return { ...state, active: sessionId, split: [active, sessionId] };
  if (split.includes(sessionId)) return { ...state, active: sessionId };
  const panes: [string, string] = split[0] === active ? [active, sessionId] : [sessionId, active];
  return { ...state, active: sessionId, split: panes };
}

function closeSplitPane(state: TabsState, sessionId: string): TabsState {
  const { split } = state;
  if (!split?.includes(sessionId)) return state;
  const remaining = split[0] === sessionId ? split[1] : split[0];
  return { ...state, active: remaining, split: null };
}

function closeTab(state: TabsState, sessionId: string): TabsState {
  if (state.split?.includes(sessionId)) {
    const unsplit = closeSplitPane(state, sessionId);
    return { ...unsplit, tabs: state.tabs.filter((tab) => tab.sessionId !== sessionId) };
  }
  const index = state.tabs.findIndex((tab) => tab.sessionId === sessionId);
  const tabs = state.tabs.filter((tab) => tab.sessionId !== sessionId);
  if (state.active !== sessionId) return { ...state, tabs };
  const neighbor = tabs[index - 1] ?? tabs[index] ?? null;
  return { ...state, tabs, active: neighbor?.sessionId ?? null };
}

export function dropIndex(input: {
  ids: readonly string[];
  draggedId: string;
  targetId: string;
  after: boolean;
}): number | null {
  const from = input.ids.indexOf(input.draggedId);
  const target = input.ids.indexOf(input.targetId);
  if (from === -1 || target === -1) return null;
  const insertion = target + (input.after ? 1 : 0);
  const toIndex = insertion > from ? insertion - 1 : insertion;
  return toIndex === from ? null : toIndex;
}

function moveTab(state: TabsState, input: { sessionId: string; toIndex: number }): TabsState {
  const from = state.tabs.findIndex((tab) => tab.sessionId === input.sessionId);
  const moving = state.tabs[from];
  const to = Math.max(0, Math.min(state.tabs.length - 1, input.toIndex));
  if (moving === undefined || from === to) return state;
  const rest = state.tabs.filter((tab) => tab.sessionId !== input.sessionId);
  return { ...state, tabs: [...rest.slice(0, to), moving, ...rest.slice(to)] };
}

function updateTab(state: TabsState, sessionId: string, patch: Partial<Tab>): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.sessionId === sessionId ? { ...tab, ...patch } : tab)),
  };
}

export function adjacentSessionId(input: { state: TabsState; delta: 1 | -1 }): string | null {
  const { state, delta } = input;
  const count = state.tabs.length;
  if (count === 0) return null;
  const current = state.tabs.findIndex((tab) => tab.sessionId === state.active);
  const next = current === -1 ? (delta === 1 ? 0 : count - 1) : (current + delta + count) % count;
  return state.tabs[next]?.sessionId ?? null;
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  if (action.type === 'open') {
    const { sessionId } = action.tab;
    if (state.tabs.some((tab) => tab.sessionId === sessionId)) return focusPane(state, sessionId);
    const opened = { ...state, tabs: [...state.tabs, { ...action.tab, exited: false }] };
    return focusPane(opened, sessionId);
  }
  if (!state.tabs.some((tab) => tab.sessionId === action.sessionId)) return state;
  switch (action.type) {
    case 'close':
      return closeTab(state, action.sessionId);
    case 'activate':
      return focusPane(state, action.sessionId);
    case 'exited':
      return updateTab(state, action.sessionId, { exited: true });
    case 'rename':
      return updateTab(state, action.sessionId, { title: action.title });
    case 'rebind':
      return updateTab(state, action.sessionId, { provider: action.provider });
    case 'split':
      return openSplit(state, action.sessionId);
    case 'unsplit':
      return closeSplitPane(state, action.sessionId);
    case 'move':
      return moveTab(state, action);
  }
}
