import { describe, expect, test } from 'vitest';
import {
  adjacentSessionId,
  initialTabsState,
  tabsReducer,
  visibleSessionIds,
  type TabsState,
} from '../src/renderer/tabs';

const empty: TabsState = initialTabsState;
const open = (state: TabsState, id: string): TabsState =>
  tabsReducer(state, {
    type: 'open',
    tab: { sessionId: id, title: `t-${id}`, kind: 'chat', provider: 'claude' },
  });

describe('tabsReducer', () => {
  test('open appends and activates the new tab', () => {
    const state = open(open(empty, 'a'), 'b');
    expect(state.tabs).toEqual([
      { sessionId: 'a', title: 't-a', exited: false, kind: 'chat', provider: 'claude' },
      { sessionId: 'b', title: 't-b', exited: false, kind: 'chat', provider: 'claude' },
    ]);
    expect(state.active).toBe('b');
  });

  test('opening an already open session only activates it', () => {
    const two = open(open(empty, 'a'), 'b');
    const state = open(two, 'a');
    expect(state.tabs).toEqual(two.tabs);
    expect(state.active).toBe('a');
  });

  test('closing the active tab activates the previous one, else the next, else null', () => {
    const three = open(open(open(empty, 'a'), 'b'), 'c');
    const middle = tabsReducer({ ...three, active: 'b' }, { type: 'close', sessionId: 'b' });
    expect(middle.active).toBe('a');
    const first = tabsReducer({ ...three, active: 'a' }, { type: 'close', sessionId: 'a' });
    expect(first.active).toBe('b');
    const last = tabsReducer(open(empty, 'a'), { type: 'close', sessionId: 'a' });
    expect(last).toEqual({ tabs: [], active: null, split: null });
  });

  test('closing an inactive tab keeps the active one', () => {
    const state = tabsReducer(open(open(empty, 'a'), 'b'), { type: 'close', sessionId: 'a' });
    expect(state.active).toBe('b');
    expect(state.tabs.map((tab) => tab.sessionId)).toEqual(['b']);
  });

  test('activate switches the active tab', () => {
    const state = tabsReducer(open(open(empty, 'a'), 'b'), { type: 'activate', sessionId: 'a' });
    expect(state.active).toBe('a');
  });

  test('exited marks the tab and keeps it open', () => {
    const state = tabsReducer(open(empty, 'a'), { type: 'exited', sessionId: 'a' });
    expect(state.tabs).toEqual([
      { sessionId: 'a', title: 't-a', exited: true, kind: 'chat', provider: 'claude' },
    ]);
    expect(state.active).toBe('a');
  });

  test('rename changes only the title of the matching tab', () => {
    const two = open(open(empty, 'a'), 'b');
    const state = tabsReducer(two, { type: 'rename', sessionId: 'a', title: 'novo' });
    expect(state.tabs.map((tab) => tab.title)).toEqual(['novo', 't-b']);
    expect(state.active).toBe('b');
  });

  test('rebind updates only the provider of the matching tab', () => {
    const two = open(open(empty, 'a'), 'b');
    const state = tabsReducer(two, { type: 'rebind', sessionId: 'a', provider: 'codex' });
    expect(state.tabs.map((tab) => tab.provider)).toEqual(['codex', 'claude']);
    expect(state.active).toBe('b');
  });

  test('unknown session ids leave the state unchanged', () => {
    const state = open(empty, 'a');
    expect(tabsReducer(state, { type: 'close', sessionId: 'zzz' })).toBe(state);
    expect(tabsReducer(state, { type: 'activate', sessionId: 'zzz' })).toBe(state);
    expect(tabsReducer(state, { type: 'exited', sessionId: 'zzz' })).toBe(state);
    expect(tabsReducer(state, { type: 'rename', sessionId: 'zzz', title: 'x' })).toBe(state);
  });
});

describe('adjacentSessionId', () => {
  const three = open(open(open(empty, 'a'), 'b'), 'c');
  const activate = (sessionId: string) => tabsReducer(three, { type: 'activate', sessionId });

  test('moves to the neighbor and wraps around both ends', () => {
    expect(adjacentSessionId({ state: activate('b'), delta: 1 })).toBe('c');
    expect(adjacentSessionId({ state: activate('b'), delta: -1 })).toBe('a');
    expect(adjacentSessionId({ state: activate('c'), delta: 1 })).toBe('a');
    expect(adjacentSessionId({ state: activate('a'), delta: -1 })).toBe('c');
  });

  test('returns null without tabs and picks an end when nothing is active', () => {
    expect(adjacentSessionId({ state: empty, delta: 1 })).toBeNull();
    const unfocused: TabsState = { ...three, active: null };
    expect(adjacentSessionId({ state: unfocused, delta: 1 })).toBe('a');
    expect(adjacentSessionId({ state: unfocused, delta: -1 })).toBe('c');
  });
});

describe('unlimited tabs', () => {
  test('opens more than three tabs', () => {
    const state = ['a', 'b', 'c', 'd', 'e'].reduce(open, empty);
    expect(state.tabs.map((tab) => tab.sessionId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(state.active).toBe('e');
  });
});

describe('split view', () => {
  const three = open(open(open(empty, 'a'), 'b'), 'c');
  const split = (state: TabsState, sessionId: string) =>
    tabsReducer(state, { type: 'split', sessionId });

  test('shows the active tab and the chosen tab side by side and focuses the new pane', () => {
    const state = split(three, 'a');
    expect(state.split).toEqual(['c', 'a']);
    expect(state.active).toBe('a');
    expect(visibleSessionIds(state)).toEqual(['c', 'a']);
  });

  test('ignores a split of the active tab or without an active tab', () => {
    expect(split(three, 'c')).toBe(three);
    const unfocused: TabsState = { ...three, active: null };
    expect(split(unfocused, 'a')).toBe(unfocused);
  });

  test('a second split replaces the unfocused pane', () => {
    const state = split(tabsReducer(split(three, 'a'), { type: 'activate', sessionId: 'c' }), 'b');
    expect(state.split).toEqual(['c', 'b']);
    expect(state.active).toBe('b');
  });

  test('activating a visible pane only moves the focus', () => {
    const state = tabsReducer(split(three, 'a'), { type: 'activate', sessionId: 'c' });
    expect(state.split).toEqual(['c', 'a']);
    expect(state.active).toBe('c');
  });

  test('activating a hidden tab replaces the focused pane', () => {
    const state = tabsReducer(split(three, 'a'), { type: 'activate', sessionId: 'b' });
    expect(state.split).toEqual(['c', 'b']);
    expect(state.active).toBe('b');
  });

  test('opening a new tab replaces the focused pane', () => {
    const state = open(split(three, 'a'), 'd');
    expect(state.split).toEqual(['c', 'd']);
    expect(state.active).toBe('d');
    expect(state.tabs).toHaveLength(4);
  });

  test('unsplit closes the pane and focuses the other one', () => {
    const state = tabsReducer(split(three, 'a'), { type: 'unsplit', sessionId: 'a' });
    expect(state.split).toBeNull();
    expect(state.active).toBe('c');
    expect(state.tabs).toHaveLength(3);
  });

  test('closing a tab in a pane ends the split and keeps the other pane', () => {
    const state = tabsReducer(split(three, 'a'), { type: 'close', sessionId: 'c' });
    expect(state.split).toBeNull();
    expect(state.active).toBe('a');
    expect(state.tabs.map((tab) => tab.sessionId)).toEqual(['a', 'b']);
  });

  test('closing a hidden tab keeps the split', () => {
    const state = tabsReducer(split(three, 'a'), { type: 'close', sessionId: 'b' });
    expect(state.split).toEqual(['c', 'a']);
    expect(state.active).toBe('a');
  });

  test('without split only the active tab is visible', () => {
    expect(visibleSessionIds(three)).toEqual(['c']);
    expect(visibleSessionIds(empty)).toEqual([]);
  });
});
