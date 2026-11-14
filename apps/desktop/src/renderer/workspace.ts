import type { Session } from '@inova/core/types';
import type { ProjectView } from '../shared/api';
import { MAX_OPEN_TABS, type Tab, type TabsState } from './tabs';

export interface WorkspaceSnapshot {
  openSessionIds: string[];
  activeSessionId: string | null;
}

export function workspaceFromTabs(input: {
  state: TabsState;
  lastChatActive: string | null;
}): WorkspaceSnapshot {
  const chats = input.state.tabs.filter((tab) => tab.kind === 'chat');
  const openSessionIds = chats.map((tab) => tab.sessionId);
  const candidates = [input.state.active, input.lastChatActive];
  const activeSessionId = candidates.find((id) => id !== null && openSessionIds.includes(id));
  return { openSessionIds, activeSessionId: activeSessionId ?? null };
}

export function workspaceKey(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify(snapshot);
}

export function restoreTabs(input: {
  workspace: WorkspaceSnapshot;
  sessions: Record<string, Session[]>;
  projects: readonly ProjectView[];
}): {
  tabs: Pick<Tab, 'sessionId' | 'title' | 'kind' | 'provider'>[];
  activeSessionId: string | null;
} {
  const known = new Map(
    Object.values(input.sessions)
      .flat()
      .map((session) => [session.id, session]),
  );
  const restorable = input.workspace.openSessionIds.flatMap((id) => {
    const session = known.get(id);
    if (!session) return [];
    const project = input.projects.find((candidate) => candidate.id === session.projectId);
    return [
      {
        sessionId: id,
        title: session.title,
        kind: 'chat' as const,
        provider: project?.provider ?? null,
      },
    ];
  });
  const tabs = restorable.slice(0, MAX_OPEN_TABS);
  const wanted = input.workspace.activeSessionId;
  const wasDropped =
    tabs.length < restorable.length && restorable.some((tab) => tab.sessionId === wanted);
  const fallback = wasDropped ? tabs[0] : tabs.at(-1);
  const activeSessionId =
    tabs.find((tab) => tab.sessionId === wanted)?.sessionId ?? fallback?.sessionId ?? null;
  return { tabs, activeSessionId };
}
