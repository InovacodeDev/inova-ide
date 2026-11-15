import type { SubagentSnapshot } from '@inova/core/chat-types';
import type { SupportedLocale } from '@inova/core/types';
import { translate } from './i18n';

export type InspectorTabId = 'context' | 'changes' | 'subagents' | 'session';

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
  changedFilesCount?: number;
  locale?: SupportedLocale;
}): InspectorTabMeta[] {
  const locale = input.locale ?? 'pt-BR';
  const counts = subagentSummaryCounts(input.subagents ?? []);
  const subagentBadge =
    counts.total === 0
      ? null
      : counts.running > 0
        ? `${counts.running}/${counts.total}`
        : String(counts.total);
  const changesCount = input.changedFilesCount ?? 0;
  return [
    { id: 'context', label: translate(locale, 'details.tab.context'), badge: null },
    {
      id: 'changes',
      label: translate(locale, 'details.tab.changes'),
      badge: changesCount > 0 ? String(changesCount) : null,
    },
    { id: 'subagents', label: translate(locale, 'details.tab.subagents'), badge: subagentBadge },
    {
      id: 'session',
      label: translate(locale, 'details.tab.session'),
      badge: input.worktreeBranch ? 'wt' : null,
    },
  ];
}
