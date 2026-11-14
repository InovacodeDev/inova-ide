import { describe, expect, test } from 'vitest';
import type { SubagentSnapshot } from '@inova/core/chat-types';
import { inspectorTabs, subagentSummaryCounts } from '../src/renderer/inspector-state';

const makeAgent = (overrides: Partial<SubagentSnapshot> = {}): SubagentSnapshot => ({
  toolId: 't1',
  description: 'Explore repo',
  agentType: 'Explore',
  model: 'haiku',
  status: 'done',
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  ...overrides,
});

describe('subagentSummaryCounts', () => {
  test('returns zeroes when empty', () => {
    expect(subagentSummaryCounts([])).toEqual({
      total: 0,
      running: 0,
      done: 0,
      error: 0,
      totalTokens: 0,
    });
  });

  test('counts statuses and sums total tokens', () => {
    const counts = subagentSummaryCounts([
      makeAgent({ toolId: 't1', status: 'running', totalTokens: 120 }),
      makeAgent({ toolId: 't2', status: 'done', totalTokens: 280 }),
      makeAgent({ toolId: 't3', status: 'error', totalTokens: 45 }),
    ]);
    expect(counts).toEqual({
      total: 3,
      running: 1,
      done: 1,
      error: 1,
      totalTokens: 445,
    });
  });
});

describe('inspectorTabs', () => {
  test('omits optional badges when no subagents and no worktree', () => {
    expect(inspectorTabs({ subagents: [], worktreeBranch: null })).toEqual([
      { id: 'context', label: 'Contexto', badge: null },
      { id: 'subagents', label: 'Subagentes', badge: null },
      { id: 'session', label: 'Sessão', badge: null },
    ]);
  });

  test('shows total subagents badge when none are running and wt badge for worktree', () => {
    expect(
      inspectorTabs({
        subagents: [
          makeAgent({ toolId: 't1', status: 'done' }),
          makeAgent({ toolId: 't2', status: 'error' }),
        ],
        worktreeBranch: 'inova/feat-ui',
      }),
    ).toEqual([
      { id: 'context', label: 'Contexto', badge: null },
      { id: 'subagents', label: 'Subagentes', badge: '2' },
      { id: 'session', label: 'Sessão', badge: 'wt' },
    ]);
  });

  test('shows running/total badge when at least one subagent is running', () => {
    expect(
      inspectorTabs({
        subagents: [
          makeAgent({ toolId: 't1', status: 'running' }),
          makeAgent({ toolId: 't2', status: 'done' }),
        ],
        worktreeBranch: null,
      }),
    ).toEqual([
      { id: 'context', label: 'Contexto', badge: null },
      { id: 'subagents', label: 'Subagentes', badge: '1/2' },
      { id: 'session', label: 'Sessão', badge: null },
    ]);
  });
});
