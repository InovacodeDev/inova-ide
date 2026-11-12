import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { Session } from '@inova/core/types';
import type { AccountView, ProjectView } from '../shared/api';
import { ChatView } from './ChatView';
import { chatStoreReducer } from './chat-store';
import { initialChatState } from './chat-reducer';
import { Footer, type UsageState } from './Footer';
import { createPtyRouter } from './pty-buffer';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { TerminalView, type TerminalSize } from './TerminalView';
import { tabsReducer, type Tab } from './tabs';
import { useWarning } from './useWarning';
import { restoreTabs, workspaceFromTabs, workspaceKey } from './workspace';

const SAVE_DEBOUNCE_MS = 300;
const DEFAULT_SIZE: TerminalSize = { cols: 120, rows: 32 };
const GEMINI_HINT = 'No Gemini, escolha "Sign in with Google" e saia com /quit.';

function subtreeIds(input: { sessions: readonly Session[]; rootId: string }): string[] {
  const ids = new Set([input.rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const session of input.sessions) {
      if (session.parentId !== null && ids.has(session.parentId) && !ids.has(session.id)) {
        ids.add(session.id);
        grew = true;
      }
    }
  }
  return [...ids];
}

export function App() {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [sessions, setSessions] = useState<Record<string, Session[]>>({});
  const [usage, setUsage] = useState<Record<string, UsageState>>({});
  const { warning, dismiss, guard, call } = useWarning();
  const [tabs, dispatch] = useReducer(tabsReducer, { tabs: [], active: null });
  const [chats, dispatchChat] = useReducer(chatStoreReducer, {});
  const sizeRef = useRef<TerminalSize>(DEFAULT_SIZE);
  const [router] = useState(createPtyRouter);

  const latest = useRef({ accounts, projects, sessions, chats });
  useEffect(() => {
    latest.current = { accounts, projects, sessions, chats };
  });

  const reloadAccounts = useCallback(async () => {
    const result = await call(() => window.inova.listAccounts());
    if (result) setAccounts(result.value);
  }, [call]);

  const reloadSessions = useCallback(
    async (projectId: string) => {
      const result = await call(() => window.inova.listSessions({ projectId }));
      if (!result) return undefined;
      setSessions((current) => ({ ...current, [projectId]: result.value }));
      for (const session of result.value) {
        dispatch({ type: 'rename', sessionId: session.id, title: session.title });
      }
      return result.value;
    },
    [call],
  );

  const reloadProjects = useCallback(async () => {
    const result = await call(() => window.inova.listProjects());
    if (!result) return undefined;
    setProjects(result.value);
    const loaded = await Promise.all(
      result.value.map(
        async (project) => [project.id, (await reloadSessions(project.id)) ?? []] as const,
      ),
    );
    return { projects: result.value, sessions: Object.fromEntries(loaded) };
  }, [call, reloadSessions]);

  const loadUsage = useCallback(async (accountLabel: string) => {
    setUsage((current) => ({ ...current, [accountLabel]: { status: 'loading' } }));
    let next: UsageState;
    try {
      const result = await window.inova.getUsage({ accountLabel });
      next = result.ok
        ? { status: 'ready', snapshot: result.value }
        : { status: 'error', message: result.message };
    } catch (error: unknown) {
      console.error('inova: unexpected renderer error', error);
      next = { status: 'error', message: 'Erro inesperado.' };
    }
    setUsage((current) => ({ ...current, [accountLabel]: next }));
  }, []);

  const loadChat = useCallback(
    async (sessionId: string) => {
      const result = await call(() => window.inova.loadTranscript({ sessionId }));
      if (result) {
        dispatchChat({ sessionId, action: { type: 'load', events: result.value } });
      }
    },
    [call],
  );

  const restoreStarted = useRef(false);
  const lastSavedKey = useRef<string | null>(null);
  const lastChatActive = useRef<string | null>(null);
  const [persisting, setPersisting] = useState(false);

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    void reloadAccounts();
    void (async () => {
      const loaded = await reloadProjects();
      if (!loaded) return;
      const saved = await call(() => window.inova.getWorkspace());
      if (!saved) return;
      const restored = restoreTabs({ workspace: saved.value, ...loaded });
      for (const tab of restored.tabs) dispatch({ type: 'open', tab });
      if (restored.activeSessionId !== null) {
        dispatch({ type: 'activate', sessionId: restored.activeSessionId });
        lastChatActive.current = restored.activeSessionId;
      }
      lastSavedKey.current = workspaceKey(saved.value);
      setPersisting(true);
      await Promise.all(restored.tabs.map((tab) => loadChat(tab.sessionId)));
    })();
  }, [reloadAccounts, reloadProjects, call, loadChat]);

  useEffect(() => {
    if (
      tabs.active !== null &&
      tabs.tabs.some((t) => t.sessionId === tabs.active && t.kind === 'chat')
    ) {
      lastChatActive.current = tabs.active;
    }
    if (!persisting) return;
    const snapshot = workspaceFromTabs({ state: tabs, lastChatActive: lastChatActive.current });
    const key = workspaceKey(snapshot);
    if (key === lastSavedKey.current) return;
    const timer = setTimeout(() => {
      lastSavedKey.current = key;
      void call(() => window.inova.saveWorkspace(snapshot));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [tabs, persisting, call]);

  useEffect(() => {
    return window.inova.onChatEvent(({ sessionId, event }) => {
      dispatchChat({ sessionId, action: { type: 'event', event } });
      if (event.kind !== 'done') return;
      const { projects: knownProjects, sessions: knownSessions } = latest.current;
      const projectId = Object.keys(knownSessions).find((id) =>
        knownSessions[id]?.some((session) => session.id === sessionId),
      );
      if (!projectId) return;
      void reloadSessions(projectId);
      const project = knownProjects.find((candidate) => candidate.id === projectId);
      if (project && project.provider !== 'gemini') void loadUsage(project.accountLabel);
    });
  }, [reloadSessions, loadUsage]);

  useEffect(() => {
    const offData = window.inova.onPtyData(({ sessionId, data }) => router.data(sessionId, data));
    const offExit = window.inova.onPtyExit(({ sessionId }) => {
      router.exit(sessionId);
      dispatch({ type: 'exited', sessionId });
      void reloadAccounts();
    });
    return () => {
      offData();
      offExit();
    };
  }, [router, reloadAccounts]);

  const openChatTab = async (session: Session) => {
    const project = latest.current.projects.find((candidate) => candidate.id === session.projectId);
    dispatch({
      type: 'open',
      tab: {
        sessionId: session.id,
        title: session.title,
        kind: 'chat',
        provider: project?.provider ?? null,
      },
    });
    if (latest.current.chats[session.id]) return;
    await loadChat(session.id);
  };

  const newSession = async (input: { project: ProjectView; parent: Session | null }) => {
    const result = await call(() =>
      window.inova.createSession({
        projectId: input.project.id,
        parentId: input.parent?.id ?? null,
      }),
    );
    if (!result) return;
    await reloadSessions(input.project.id);
    await openChatTab(result.value);
  };

  const sendMessage = async (sessionId: string, prompt: string) => {
    dispatchChat({ sessionId, action: { type: 'started' } });
    const result = await call(() => window.inova.sendMessage({ sessionId, prompt }));
    if (!result) {
      dispatchChat({
        sessionId,
        action: {
          type: 'event',
          event: { kind: 'done', isError: true, costUsd: null, durationMs: null },
        },
      });
    }
  };

  const openLogin = async (account: AccountView) => {
    const result = await call(() =>
      window.inova.openLogin({ accountLabel: account.label, ...sizeRef.current }),
    );
    if (!result) return;
    const { sessionId, title } = result.value;
    dispatch({
      type: 'open',
      tab: { sessionId, title, kind: 'login', provider: account.provider },
    });
    if (router.consumeExit(sessionId)) {
      dispatch({ type: 'exited', sessionId });
      void reloadAccounts();
    }
  };

  const closeTab = (tab: Tab) => {
    if (tab.kind === 'chat') {
      if (latest.current.chats[tab.sessionId]?.running) window.inova.cancelTurn(tab.sessionId);
      dispatch({ type: 'close', sessionId: tab.sessionId });
      return;
    }
    void guard(async () => window.inova.ptyClose(tab.sessionId));
    router.close(tab.sessionId);
    dispatch({ type: 'close', sessionId: tab.sessionId });
    void reloadAccounts();
  };

  const dropSessions = (sessionIds: string[]) => {
    for (const sessionId of sessionIds) {
      if (latest.current.chats[sessionId]?.running) window.inova.cancelTurn(sessionId);
      dispatch({ type: 'close', sessionId });
    }
    dispatchChat({ type: 'drop', sessionIds });
  };

  const sessionIdsOf = (projectIds: string[]): string[] =>
    projectIds.flatMap((id) => (latest.current.sessions[id] ?? []).map((session) => session.id));

  const deleteSession = async (session: Session) => {
    const known = latest.current.sessions[session.projectId] ?? [];
    const result = await call(() => window.inova.deleteSession({ sessionId: session.id }));
    if (!result) return;
    dropSessions(subtreeIds({ sessions: known, rootId: session.id }));
    await reloadSessions(session.projectId);
  };

  const renameSession = async (input: { session: Session; title: string }) => {
    const result = await call(() =>
      window.inova.updateSession({ sessionId: input.session.id, title: input.title }),
    );
    if (!result) return;
    await reloadSessions(input.session.projectId);
    dispatch({ type: 'rename', sessionId: input.session.id, title: result.value.title });
  };

  const setArchived = async (input: { session: Session; archived: boolean }) => {
    const known = latest.current.sessions[input.session.projectId] ?? [];
    const result = await call(() =>
      window.inova.updateSession({ sessionId: input.session.id, archived: input.archived }),
    );
    if (!result) return;
    if (input.archived) {
      dropSessions(subtreeIds({ sessions: known, rootId: input.session.id }));
    }
    await reloadSessions(input.session.projectId);
  };

  const addProject = async (accountLabel: string) => {
    const path = await guard(() => window.inova.pickFolder());
    if (!path) return;
    const result = await call(() => window.inova.bindProject({ path, accountLabel }));
    if (result) await reloadProjects();
  };

  const removeAccount = async (account: AccountView) => {
    const message = `Remover a conta ${account.label}? Os projetos vinculados a ela serão desvinculados.`;
    if (!confirm(message)) return;
    const result = await call(() =>
      window.inova.removeAccount({ label: account.label, force: true }),
    );
    if (!result) return;
    const removedProjectIds = latest.current.projects
      .filter((project) => project.accountLabel === account.label)
      .map((project) => project.id);
    dropSessions(sessionIdsOf(removedProjectIds));
    await Promise.all([reloadAccounts(), reloadProjects()]);
  };

  const archivedIds = new Set(
    Object.values(sessions)
      .flat()
      .filter((session) => session.archivedAt !== null)
      .map((session) => session.id),
  );

  const activeTab = tabs.tabs.find((tab) => tab.sessionId === tabs.active);

  return (
    <div className="app">
      {warning && (
        <div className="warning" role="alert" onClick={dismiss}>
          {warning}
        </div>
      )}
      <Sidebar
        accounts={accounts}
        projects={projects}
        sessions={sessions}
        activeSessionId={activeTab?.kind === 'chat' ? activeTab.sessionId : null}
        onOpenSession={(session) => void openChatTab(session)}
        onNewSession={(input) => void newSession(input)}
        onAddProject={(label) => void addProject(label)}
        onUnbind={async (project) => {
          const result = await call(() => window.inova.unbindProject({ path: project.path }));
          if (!result) return;
          dropSessions(sessionIdsOf([project.id]));
          await reloadProjects();
        }}
        onRenameSession={(input) => void renameSession(input)}
        onDeleteSession={(session) => void deleteSession(session)}
        onArchiveSession={(session) => void setArchived({ session, archived: true })}
        onUnarchiveSession={(session) => void setArchived({ session, archived: false })}
      />
      <main className="main">
        <TabBar
          state={tabs}
          onActivate={(sessionId) => dispatch({ type: 'activate', sessionId })}
          onClose={(sessionId) => {
            const tab = tabs.tabs.find((candidate) => candidate.sessionId === sessionId);
            if (tab) closeTab(tab);
          }}
        />
        {activeTab?.kind === 'login' && activeTab.provider === 'gemini' && !activeTab.exited && (
          <p className="hint">{GEMINI_HINT}</p>
        )}
        <div className="terminals">
          {tabs.tabs.map((tab) =>
            tab.kind === 'chat' ? (
              <ChatView
                key={tab.sessionId}
                state={chats[tab.sessionId] ?? initialChatState}
                visible={tab.sessionId === tabs.active}
                title={tab.title}
                readOnly={archivedIds.has(tab.sessionId)}
                onSend={(prompt) => void sendMessage(tab.sessionId, prompt)}
                onCancel={() => window.inova.cancelTurn(tab.sessionId)}
              />
            ) : (
              <TerminalView
                key={tab.sessionId}
                sessionId={tab.sessionId}
                visible={tab.sessionId === tabs.active}
                exited={tab.exited}
                attach={router.attach}
                onSize={(size) => {
                  sizeRef.current = size;
                }}
              />
            ),
          )}
        </div>
      </main>
      <Footer
        accounts={accounts}
        focusedProvider={activeTab?.provider ?? null}
        usage={usage}
        onLoadUsage={(account) => void loadUsage(account.label)}
        onLogin={(account) => void openLogin(account)}
        onRemove={(account) => void removeAccount(account)}
        onAddAccount={async (input) => {
          const result = await call(() => window.inova.addAccount(input));
          if (result) await reloadAccounts();
        }}
      />
    </div>
  );
}
