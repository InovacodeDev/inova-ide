import { describe, expect, test } from 'vitest';
import type { Session } from '@inova/core/types';
import type { ProjectView } from '../src/shared/api';
import type { Tab, TabsState } from '../src/renderer/tabs';
import { restoreTabs, workspaceFromTabs } from '../src/renderer/workspace';

const tab = (sessionId: string, kind: Tab['kind']): Tab => ({
  sessionId,
  title: sessionId,
  exited: false,
  kind,
  provider: 'claude',
});

const session = (id: string): Session => ({
  id,
  projectId: 'p',
  parentId: null,
  title: `title-${id}`,
  providerSessionId: null,
  createdAt: '',
  updatedAt: '',
  archivedAt: null,
});

const project: ProjectView = { id: 'p', path: '/x', accountLabel: 'a', provider: 'claude' };

describe('workspaceFromTabs', () => {
  test('lists only chat tabs in order and the active chat', () => {
    const state: TabsState = {
      tabs: [tab('a', 'chat'), tab('l', 'login'), tab('b', 'chat')],
      active: 'b',
    };
    expect(workspaceFromTabs({ state, lastChatActive: null })).toEqual({
      openSessionIds: ['a', 'b'],
      activeSessionId: 'b',
    });
  });

  test('falls back to the last active chat when a login tab is active', () => {
    const state: TabsState = { tabs: [tab('a', 'chat'), tab('l', 'login')], active: 'l' };
    expect(workspaceFromTabs({ state, lastChatActive: 'a' }).activeSessionId).toBe('a');
  });

  test('returns null active when no chat tab matches', () => {
    const state: TabsState = { tabs: [tab('l', 'login')], active: 'l' };
    expect(workspaceFromTabs({ state, lastChatActive: 'gone' })).toEqual({
      openSessionIds: [],
      activeSessionId: null,
    });
  });
});

describe('restoreTabs', () => {
  const sessions = { p: [session('a'), session('b')] };

  test('skips unknown ids and activates the saved session', () => {
    const result = restoreTabs({
      workspace: { openSessionIds: ['a', 'zz', 'b'], activeSessionId: 'a' },
      sessions,
      projects: [project],
    });
    expect(result.tabs.map((t) => t.sessionId)).toEqual(['a', 'b']);
    expect(result.tabs[0]).toMatchObject({ title: 'title-a', provider: 'claude', kind: 'chat' });
    expect(result.activeSessionId).toBe('a');
  });

  test('activates the last tab when the saved active id is missing', () => {
    const result = restoreTabs({
      workspace: { openSessionIds: ['a', 'b'], activeSessionId: null },
      sessions,
      projects: [project],
    });
    expect(result.activeSessionId).toBe('b');
  });

  test('returns nothing for an empty workspace', () => {
    const result = restoreTabs({
      workspace: { openSessionIds: [], activeSessionId: null },
      sessions,
      projects: [project],
    });
    expect(result).toEqual({ tabs: [], activeSessionId: null });
  });
});
