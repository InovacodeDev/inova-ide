import type { SubagentSnapshot } from '@inova/core/chat-types';

export type InspectorTabId = 'context' | 'subagents' | 'session';

export interface InspectorTabMeta {
  id: InspectorTabId;
  label: string;
  badge: string | null;
}

export interface SubagentSummaryCounts {
  total: number;
  running: number;
  done: number;
  error: number;
  totalTokens: number;
}

export function subagentSummaryCounts(
  subagents: readonly SubagentSnapshot[] = [],
): SubagentSummaryCounts {
  let running = 0;
  let done = 0;
  let error = 0;
  let totalTokens = 0;
  for (const agent of subagents) {
    if (agent.status === 'running') running += 1;
    else if (agent.status === 'done') done += 1;
    else error += 1;
    totalTokens += agent.totalTokens;
  }
  return {
    total: subagents.length,
    running,
    done,
    error,
    totalTokens,
  };
}

export function inspectorTabs(input: {
  subagents?: readonly SubagentSnapshot[];
  worktreeBranch?: string | null;
}): InspectorTabMeta[] {
  const counts = subagentSummaryCounts(input.subagents ?? []);
  const subagentBadge =
    counts.total === 0
      ? null
      : counts.running > 0
        ? `${counts.running}/${counts.total}`
        : String(counts.total);
  return [
    { id: 'context', label: 'Contexto', badge: null },
    { id: 'subagents', label: 'Subagentes', badge: subagentBadge },
    { id: 'session', label: 'Sessão', badge: input.worktreeBranch ? 'wt' : null },
  ];
}
