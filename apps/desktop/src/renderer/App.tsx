import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { PROVIDER_MODELS, type ProviderModels } from '@inova/core/models';
import type { EffortLevel, Session } from '@inova/core/types';
import type { AccountView, ProjectView } from '../shared/api';
import { AccountsView } from './AccountsView';
import { agentTail } from './agent-tail';
import { AgentsView } from './AgentsView';
import { ChatView } from './ChatView';
import { ConfirmModal } from './ConfirmModal';
import { chatStoreReducer } from './chat-store';
import { initialChatState } from './chat-reducer';
import { Footer, type UsageState } from './Footer';
import { Header } from './Header';
import { AlertIcon } from './icons';
import { LoginModal, type LoginModalState } from './LoginModal';
import { NewSessionView, type NewSessionTarget } from './NewSessionView';
import { accountDisplayName } from './provider-meta';
import { SessionDetails } from './SessionDetails';
import { SessionHeader } from './SessionHeader';
import { sessionStatus } from './session-status';
import { Sidebar, type View } from './Sidebar';
import { tabsReducer, type Tab } from './tabs';
import { useWarning } from './useWarning';
import { restoreTabs, workspaceFromTabs, workspaceKey } from './workspace';

const SAVE_DEBOUNCE_MS = 300;

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

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
  const [modelsByAccount, setModelsByAccount] = useState<Record<string, ProviderModels>>({});
  const loadingModelsRef = useRef<Set<string>>(new Set());
  const [view, setView] = useState<View>('workspace');
  const [loginModal, setLoginModal] = useState<LoginModalState | null>(null);
  const [pendingRemoveAccount, setPendingRemoveAccount] = useState<AccountView | null>(null);
  const [pendingCloseTab, setPendingCloseTab] = useState<Tab | null>(null);
  const { warning, dismiss, guard, call } = useWarning();
  const [tabs, dispatch] = useReducer(tabsReducer, { tabs: [], active: null });
  const [chats, dispatchChat] = useReducer(chatStoreReducer, {});

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
    setUsage((current) =>
      current[accountLabel]?.status === 'ready'
        ? current
        : { ...current, [accountLabel]: { status: 'loading' } },
    );
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

  const loadModels = useCallback(async (accountLabel: string) => {
    if (loadingModelsRef.current.has(accountLabel)) return;
    loadingModelsRef.current.add(accountLabel);
    try {
      const result = await window.inova.listModels({ accountLabel });
      if (result.ok) {
        setModelsByAccount((current) => ({ ...current, [accountLabel]: result.value }));
      }
    } catch (error: unknown) {
      console.error('inova: unexpected renderer error', error);
    } finally {
      loadingModelsRef.current.delete(accountLabel);
    }
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
    if (tabs.active !== null) lastChatActive.current = tabs.active;
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
      if (project) void loadUsage(project.accountLabel);
    });
  }, [reloadSessions, loadUsage]);

  useEffect(() => {
    return window.inova.onLoginEvent((event) => {
      setLoginModal((current) => {
        if (!current) return current;
        if (current.sessionId !== null && current.sessionId !== event.sessionId) return current;
        return {
          ...current,
          sessionId: event.sessionId,
          stage: event.stage,
          authUrl: event.authUrl ?? current.authUrl,
          codePrompt: current.codePrompt || event.codePrompt,
          message: event.message,
        };
      });
      if (event.stage === 'succeeded') {
        void reloadAccounts();
        void reloadProjects();
      }
    });
  }, [reloadAccounts, reloadProjects]);

  const openChatTab = async (session: Session, knownProject?: ProjectView) => {
    const project =
      knownProject ??
      latest.current.projects.find((candidate) => candidate.id === session.projectId);
    setView('workspace');
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
    await openChatTab(result.value, input.project);
    return result.value;
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

  const startAccountLogin = async (account: AccountView) => {
    setLoginModal({
      sessionId: null,
      provider: account.provider,
      accountLabel: account.label,
      accountEmail: account.email,
      stage: 'starting',
      authUrl: null,
      codePrompt: false,
      message: null,
    });
    let started: Awaited<ReturnType<typeof window.inova.startLogin>>;
    try {
      started = await window.inova.startLogin({ accountLabel: account.label });
    } catch (error: unknown) {
      console.error('inova: startLogin failed', error);
      setLoginModal((current) =>
        current?.accountLabel === account.label
          ? { ...current, stage: 'failed', message: 'Erro inesperado ao iniciar autenticação.' }
          : current,
      );
      return;
    }
    if (!started.ok) {
      setLoginModal((current) =>
        current?.accountLabel === account.label
          ? { ...current, stage: 'failed', message: started.message }
          : current,
      );
      return;
    }
    const { sessionId } = started.value;
    setLoginModal((current) =>
      current && current.accountLabel === account.label && current.sessionId === null
        ? { ...current, sessionId }
        : current,
    );
  };

  const closeTab = (tab: Tab) => {
    if (latest.current.chats[tab.sessionId]?.running) window.inova.cancelTurn(tab.sessionId);
    dispatch({ type: 'close', sessionId: tab.sessionId });
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

  const updateSessionModelConfig = async (input: {
    sessionId: string;
    patch: { model?: string | null; effort?: EffortLevel | null };
  }) => {
    const result = await call(() =>
      window.inova.updateSession({ sessionId: input.sessionId, ...input.patch }),
    );
    if (!result) return;
    const updated = result.value;
    setSessions((current) => ({
      ...current,
      [updated.projectId]: (current[updated.projectId] ?? []).map((item) =>
        item.id === updated.id ? updated : item,
      ),
    }));
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

  const startSession = async (input: { target: NewSessionTarget; prompt: string }) => {
    let project: ProjectView;
    if (input.target.kind === 'project') {
      project = input.target.project;
    } else {
      const { path, accountLabel } = input.target;
      const bound = await call(() => window.inova.bindProject({ path, accountLabel }));
      if (!bound) return;
      await reloadProjects();
      project = bound.value;
    }
    const session = await newSession({ project, parent: null });
    if (session && input.prompt !== '') await sendMessage(session.id, input.prompt);
  };

  const confirmRemoveAccount = async (account: AccountView) => {
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

  const accountDisplayOf = (project: ProjectView | undefined): string | null => {
    if (!project) return null;
    const matched = accounts.find((candidate) => candidate.label === project.accountLabel);
    return accountDisplayName({
      label: project.accountLabel,
      email: matched?.email ?? project.accountEmail,
    });
  };

  const archivedIds = new Set(
    Object.values(sessions)
      .flat()
      .filter((session) => session.archivedAt !== null)
      .map((session) => session.id),
  );

  const activeTab = tabs.tabs.find((tab) => tab.sessionId === tabs.active);
  const inWorkspace = view === 'workspace';

  const sessionById = new Map(
    Object.values(sessions)
      .flat()
      .map((session) => [session.id, session] as const),
  );
  const projectOf = (sessionId: string): ProjectView | undefined => {
    const projectId = sessionById.get(sessionId)?.projectId;
    return projects.find((project) => project.id === projectId);
  };

  const activeSession = activeTab?.kind === 'chat' ? sessionById.get(activeTab.sessionId) : null;
  const activeParentTitle = activeSession?.parentId
    ? (sessionById.get(activeSession.parentId)?.title ?? null)
    : null;
  const activeProject = activeTab ? projectOf(activeTab.sessionId) : undefined;
  const chatTabs = tabs.tabs.filter((tab) => tab.kind === 'chat');
  const activeAccountLabel = activeProject?.accountLabel ?? null;

  useEffect(() => {
    if (activeAccountLabel && !modelsByAccount[activeAccountLabel]) {
      void loadModels(activeAccountLabel);
    }
  }, [activeAccountLabel, modelsByAccount, loadModels]);

  return (
    <div className="app">
      {warning && (
        <div className="warning" role="alert" onClick={dismiss}>
          <span className="warning-icon" aria-hidden="true">
            <AlertIcon size={16} />
          </span>
          <span>{warning}</span>
        </div>
      )}
      <Header runningCount={Object.values(chats).filter((chat) => chat.running).length} />
      <div className="app-body">
        <Sidebar
          view={view}
          onNavigate={setView}
          accounts={accounts}
          projects={projects}
          sessions={sessions}
          activeSessionId={inWorkspace ? tabs.active : null}
          statusOf={(sessionId) => sessionStatus(chats[sessionId])}
          onOpenSession={(session) => void openChatTab(session)}
          onNewSession={(input) => void newSession(input)}
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
          {view === 'agents' && (
            <AgentsView
              agents={chatTabs.map((tab) => {
                const project = projectOf(tab.sessionId);
                return {
                  sessionId: tab.sessionId,
                  title: tab.title,
                  provider: tab.provider,
                  where: project
                    ? `${folderName(project.path)} · ${accountDisplayOf(project)}`
                    : '',
                  status: sessionStatus(chats[tab.sessionId]),
                  tail: agentTail({ items: chats[tab.sessionId]?.items ?? [], lines: 3 }),
                };
              })}
              onOpen={(sessionId) => {
                setView('workspace');
                dispatch({ type: 'activate', sessionId });
              }}
              onNewSession={() => setView('new-session')}
            />
          )}
          {view === 'accounts' && (
            <AccountsView
              accounts={accounts}
              projects={projects}
              usage={usage}
              loggingInLabel={
                loginModal &&
                (loginModal.stage === 'starting' ||
                  loginModal.stage === 'waiting-auth' ||
                  loginModal.stage === 'verifying')
                  ? loginModal.accountLabel
                  : null
              }
              onLoadUsage={(account) => void loadUsage(account.label)}
              onLogin={(account) => void startAccountLogin(account)}
              onRemove={(account) => setPendingRemoveAccount(account)}
              onAddAccount={async (input) => {
                const result = await call(() => window.inova.addAccount(input));
                if (!result) return false;
                await reloadAccounts();
                return true;
              }}
            />
          )}
          {view === 'new-session' && (
            <NewSessionView
              accounts={accounts}
              projects={projects}
              onPickFolder={async () => (await guard(() => window.inova.pickFolder())) ?? null}
              onStart={startSession}
              onCancel={() => setView('workspace')}
              onManageAccounts={() => setView('accounts')}
            />
          )}
          <div className="main-content" style={inWorkspace ? undefined : { display: 'none' }}>
            {activeTab ? (
              <SessionHeader
                key={activeTab.sessionId}
                title={activeTab.title}
                kind={activeSession?.parentId ? 'subsession' : 'session'}
                sectionName={activeProject ? folderName(activeProject.path) : null}
                parentTitle={activeParentTitle}
                provider={activeTab.provider}
                accountDisplay={accountDisplayOf(activeProject)}
                path={activeProject?.path ?? null}
                status={
                  activeTab.kind === 'chat' ? sessionStatus(chats[activeTab.sessionId]) : null
                }
                exited={activeTab.exited}
                onRename={
                  activeSession
                    ? (title) => void renameSession({ session: activeSession, title })
                    : undefined
                }
                onClose={() => {
                  if (chats[activeTab.sessionId]?.running) setPendingCloseTab(activeTab);
                  else closeTab(activeTab);
                }}
              />
            ) : (
              <p className="hint">Nenhuma sessão aberta. Escolha uma sessão ou crie uma nova.</p>
            )}
            {tabs.tabs.map((tab) => {
              const tabSession = sessionById.get(tab.sessionId);
              const tabProject = projectOf(tab.sessionId);
              const tabCatalog =
                (tabProject ? modelsByAccount[tabProject.accountLabel] : undefined) ??
                PROVIDER_MODELS[tab.provider ?? 'claude'];
              return (
                <ChatView
                  key={tab.sessionId}
                  state={chats[tab.sessionId] ?? initialChatState}
                  visible={inWorkspace && tab.sessionId === tabs.active}
                  provider={tab.provider}
                  accountDisplay={accountDisplayOf(tabProject)}
                  model={tabSession?.model ?? null}
                  effort={tabSession?.effort ?? null}
                  catalog={tabCatalog}
                  readOnly={archivedIds.has(tab.sessionId)}
                  onChangeModelConfig={(patch) =>
                    void updateSessionModelConfig({ sessionId: tab.sessionId, patch })
                  }
                  onSend={(prompt) => void sendMessage(tab.sessionId, prompt)}
                  onCancel={() => window.inova.cancelTurn(tab.sessionId)}
                />
              );
            })}
          </div>
        </main>
        {inWorkspace && activeSession && activeProject && (
          <SessionDetails
            session={activeSession}
            parentTitle={activeParentTitle}
            project={activeProject}
            account={accounts.find((account) => account.label === activeProject.accountLabel)}
            usage={usage[activeProject.accountLabel]}
          />
        )}
      </div>
      <Footer
        accounts={accounts}
        focusedAccountLabel={inWorkspace ? (activeProject?.accountLabel ?? null) : null}
        usage={usage}
        onLoadUsage={(account) => void loadUsage(account.label)}
        onManageAccounts={() => setView('accounts')}
      />
      {loginModal && (
        <LoginModal
          key={loginModal.sessionId ?? loginModal.accountLabel}
          state={{
            ...loginModal,
            accountEmail:
              accounts.find((candidate) => candidate.label === loginModal.accountLabel)?.email ??
              loginModal.accountEmail,
          }}
          onCancel={(sessionId) => window.inova.cancelLogin(sessionId)}
          onClose={() => setLoginModal(null)}
          onRetry={() => {
            const target = accounts.find((account) => account.label === loginModal.accountLabel);
            if (target) void startAccountLogin(target);
            else setLoginModal(null);
          }}
          onSubmitCode={async (input) => {
            const res = await call(() => window.inova.submitLoginCode(input));
            return res !== undefined;
          }}
        />
      )}
      {pendingRemoveAccount && (
        <ConfirmModal
          title="Deslogar e remover conta"
          description={`Deslogar e remover a conta ${accountDisplayName(pendingRemoveAccount)}? As seções e sessões vinculadas a ela serão removidas.`}
          confirmLabel="Deslogar e remover"
          danger
          onCancel={() => setPendingRemoveAccount(null)}
          onConfirm={() => {
            const target = pendingRemoveAccount;
            setPendingRemoveAccount(null);
            void confirmRemoveAccount(target);
          }}
        />
      )}
      {pendingCloseTab && (
        <ConfirmModal
          title="Encerrar sessão em andamento"
          description={`A sessão "${pendingCloseTab.title}" ainda está executando uma resposta. Fechar a aba encerrará o turno atual.`}
          confirmLabel="Encerrar e fechar"
          danger
          onCancel={() => setPendingCloseTab(null)}
          onConfirm={() => {
            const target = pendingCloseTab;
            setPendingCloseTab(null);
            closeTab(target);
          }}
        />
      )}
    </div>
  );
}
