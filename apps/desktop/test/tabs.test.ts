import { describe, expect, test } from 'vitest';
import { tabsReducer, type TabsState } from '../src/renderer/tabs';

const empty: TabsState = { tabs: [], active: null };
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
    expect(last).toEqual({ tabs: [], active: null });
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

  test('unknown session ids leave the state unchanged', () => {
    const state = open(empty, 'a');
    expect(tabsReducer(state, { type: 'close', sessionId: 'zzz' })).toBe(state);
    expect(tabsReducer(state, { type: 'activate', sessionId: 'zzz' })).toBe(state);
    expect(tabsReducer(state, { type: 'exited', sessionId: 'zzz' })).toBe(state);
    expect(tabsReducer(state, { type: 'rename', sessionId: 'zzz', title: 'x' })).toBe(state);
  });
});
