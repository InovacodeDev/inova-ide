import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { PROVIDER_MODELS, type ProviderModels } from '@inova/core/models';
import type {
  EffortLevel,
  ExecutionMode,
  InboxItem,
  ProviderId,
  QueuedTurn,
  Session,
  VerificationCheck,
} from '@inova/core/types';
import type {
  AccountView,
  ComparisonDiffView,
  ProfileSyncApplyResult,
  ProfileSyncPreview,
  ProjectView,
  RulesFile,
  RulesStrategy,
  WorktreeStatusView,
} from '../shared/api';
import { AccountsView } from './AccountsView';
import { agentTail } from './agent-tail';
import { AgentsView } from './AgentsView';
import { ChatView } from './ChatView';
import { CompareView } from './CompareView';
import { ConfirmModal } from './ConfirmModal';
import { chatStoreReducer } from './chat-store';
import { initialChatState } from './chat-reducer';
import { Footer, type UsageState } from './Footer';
import { ForkModal } from './ForkModal';
import { HandoffModal } from './HandoffModal';
import { Header } from './Header';
import { AlertIcon } from './icons';
import { LoginModal, type LoginModalState } from './LoginModal';
import { NewSessionView, type NewSessionTarget } from './NewSessionView';
import { ProfileSyncModal } from './ProfileSyncModal';
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
  const [defaultModes, setDefaultModes] = useState<Partial<Record<ProviderId, ExecutionMode>>>({});
  const loadingModelsRef = useRef<Set<string>>(new Set());
  const [view, setView] = useState<View>('workspace');
  const [loginModal, setLoginModal] = useState<LoginModalState | null>(null);
  const [pendingRemoveAccount, setPendingRemoveAccount] = useState<AccountView | null>(null);
  const [pendingCloseTab, setPendingCloseTab] = useState<Tab | null>(null);
  const [pendingForceDelete, setPendingForceDelete] = useState<Session | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{
    sessionId: string;
    ref: string;
    skippedLargeFiles: string[];
  } | null>(null);
  const [worktreeModal, setWorktreeModal] = useState<{
    session: Session;
    status: WorktreeStatusView;
  } | null>(null);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [turnQueue, setTurnQueue] = useState<QueuedTurn[]>([]);
  const [busyConflicts, setBusyConflicts] = useState<
    Record<string, { prompt: string; exhausted: boolean }>
  >({});
  const [pendingFork, setPendingFork] = useState<{
    session: Session;
    turnIndex: number;
    isLatestTurn: boolean;
  } | null>(null);
  const [pendingHandoff, setPendingHandoff] = useState<Session | null>(null);
  const [selectedComparisonGroupId, setSelectedComparisonGroupId] = useState<string | null>(null);
  const [profileSyncProject, setProfileSyncProject] = useState<ProjectView | null>(null);
  const [compareMetrics, setCompareMetrics] = useState<
    Record<string, { costUsd: number | null; durationMs: number | null }>
  >({});
  const [windowFocused, setWindowFocused] = useState(() =>
    typeof document !== 'undefined' ? document.hasFocus() : true,
  );
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
    void call(() => window.inova.getDefaultModes()).then((loadedModes) => {
      if (loadedModes) setDefaultModes(loadedModes.value);
    });
    void call(() => window.inova.listInbox()).then((loadedInbox) => {
      if (loadedInbox) setInboxItems(loadedInbox.value);
    });
    void call(() => window.inova.listTurnQueue()).then((loadedQueue) => {
      if (loadedQueue) setTurnQueue(loadedQueue.value);
    });
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
      if (event.kind === 'user') dispatchChat({ sessionId, action: { type: 'started' } });
      dispatchChat({ sessionId, action: { type: 'event', event } });
      if (event.kind !== 'done') return;
      setCompareMetrics((current) => ({
        ...current,
        [sessionId]: { costUsd: event.costUsd, durationMs: event.durationMs },
      }));
      const {
        accounts: knownAccounts,
        projects: knownProjects,
        sessions: knownSessions,
      } = latest.current;
      const projectId = Object.keys(knownSessions).find((id) =>
        knownSessions[id]?.some((session) => session.id === sessionId),
      );
      if (!projectId) return;
      void reloadSessions(projectId);
      const session = knownSessions[projectId]?.find((item) => item.id === sessionId);
      const project = knownProjects.find((candidate) => candidate.id === projectId);
      const overridden = session?.accountIdOverride
        ? knownAccounts.find((candidate) => candidate.id === session.accountIdOverride)
        : undefined;
      const usageLabel = overridden?.label ?? project?.accountLabel;
      if (usageLabel) void loadUsage(usageLabel);
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

  useEffect(() => {
    return window.inova.onInboxEvent((items) => setInboxItems(items));
  }, []);

  useEffect(() => {
    return window.inova.onQueueEvent((queue) => setTurnQueue(queue));
  }, []);

  useEffect(() => {
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    window.inova.reportUiFocus({
      activeSessionId: view === 'workspace' ? tabs.active : null,
      windowFocused,
    });
  }, [view, tabs.active, windowFocused]);

  const effectiveAccountOf = (
    session: Session | null | undefined,
    project: ProjectView | undefined,
  ): AccountView | undefined => {
    if (session?.accountIdOverride) {
      const overridden = accounts.find((candidate) => candidate.id === session.accountIdOverride);
      if (overridden) return overridden;
    }
    return project
      ? accounts.find((candidate) => candidate.label === project.accountLabel)
      : undefined;
  };

  const openChatTab = async (session: Session, knownProject?: ProjectView) => {
    const project =
      knownProject ??
      latest.current.projects.find((candidate) => candidate.id === session.projectId);
    const effective =
      (session.accountIdOverride
        ? latest.current.accounts.find((candidate) => candidate.id === session.accountIdOverride)
        : undefined) ??
      (project
        ? latest.current.accounts.find((candidate) => candidate.label === project.accountLabel)
        : undefined);
    setView('workspace');
    dispatch({
      type: 'open',
      tab: {
        sessionId: session.id,
        title: session.title,
        kind: 'chat',
        provider: effective?.provider ?? project?.provider ?? null,
      },
    });
    void window.inova.markInboxRead({ sessionId: session.id });
    if (latest.current.chats[session.id]) return;
    await loadChat(session.id);
  };

  const newSession = async (input: {
    project: ProjectView;
    parent: Session | null;
    isolatedWorktree?: boolean;
  }) => {
    const result = await call(() =>
      window.inova.createSession({
        projectId: input.project.id,
        parentId: input.parent?.id ?? null,
        ...(input.isolatedWorktree === undefined
          ? {}
          : { isolatedWorktree: input.isolatedWorktree }),
      }),
    );
    if (!result) return;
    await reloadSessions(input.project.id);
    await openChatTab(result.value, input.project);
    return result.value;
  };

  const sendMessage = async (sessionId: string, prompt: string) => {
    dispatchChat({ sessionId, action: { type: 'started' } });
    const result = await guard(() => window.inova.sendMessage({ sessionId, prompt }));
    if (!result || !result.ok) {
      dispatchChat({
        sessionId,
        action: {
          type: 'event',
          event: { kind: 'done', isError: true, costUsd: null, durationMs: null },
        },
      });
      if (result && !result.ok) {
        if (result.message.startsWith('CONTA_OCUPADA:')) {
          setBusyConflicts((current) => ({
            ...current,
            [sessionId]: { prompt, exhausted: false },
          }));
        } else if (result.message.startsWith('CONTA_ESGOTADA:')) {
          setBusyConflicts((current) => ({ ...current, [sessionId]: { prompt, exhausted: true } }));
        } else {
          await call(() => Promise.resolve(result));
        }
      }
      return;
    }
    setBusyConflicts((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  };

  const clearBusyConflict = (sessionId: string) => {
    setBusyConflicts((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  };

  const enqueuePrompt = async (sessionId: string, prompt: string) => {
    const result = await call(() => window.inova.enqueueTurn({ sessionId, prompt }));
    if (result) clearBusyConflict(sessionId);
  };

  const cancelQueuedTurn = async (turnId: string) => {
    await call(() => window.inova.cancelQueuedTurn({ turnId }));
  };

  const switchAccountAndRetry = async (input: {
    sessionId: string;
    accountId: string;
    prompt: string;
  }) => {
    const switched = await call(() =>
      window.inova.switchSessionAccount({
        sessionId: input.sessionId,
        accountId: input.accountId,
        generateHandoff: true,
      }),
    );
    if (!switched) return;
    clearBusyConflict(input.sessionId);
    const updated = switched.value.session;
    const matched = accounts.find((candidate) => candidate.id === input.accountId);
    await reloadSessions(updated.projectId);
    dispatch({
      type: 'open',
      tab: {
        sessionId: updated.id,
        title: updated.title,
        kind: 'chat',
        provider: matched?.provider ?? null,
      },
    });
    await sendMessage(updated.id, input.prompt);
  };

  const confirmForkSession = async (input: {
    session: Session;
    turnIndex: number;
    targetAccountId?: string;
    copyWorktreeFiles: boolean;
  }) => {
    const result = await call(() =>
      window.inova.forkSession({
        sessionId: input.session.id,
        turnIndex: input.turnIndex,
        ...(input.targetAccountId ? { targetAccountId: input.targetAccountId } : {}),
        copyWorktreeFiles: input.copyWorktreeFiles,
      }),
    );
    if (!result) return;
    const created = result.value.session;
    await reloadSessions(created.projectId);
    await openChatTab(created);
  };

  const confirmHandoffSession = async (input: {
    session: Session;
    targetAccountId: string;
    createWorktree: boolean;
  }) => {
    const result = await call(() =>
      window.inova.handoffSession({
        sessionId: input.session.id,
        targetAccountId: input.targetAccountId,
        createWorktree: input.createWorktree,
      }),
    );
    if (!result) return;
    clearBusyConflict(input.session.id);
    const created = result.value.session;
    await reloadSessions(created.projectId);
    await openChatTab(created);
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

  const deleteSession = async (session: Session, force = false) => {
    const known = latest.current.sessions[session.projectId] ?? [];
    const response = await guard(() =>
      window.inova.deleteSession({ sessionId: session.id, force }),
    );
    if (!response) return;
    if (!response.ok) {
      if (!force && response.message.includes('worktree')) {
        setPendingForceDelete(session);
        return;
      }
      await call(() => Promise.resolve(response));
      return;
    }
    dropSessions(subtreeIds({ sessions: known, rootId: session.id }));
    await reloadSessions(session.projectId);
  };

  const inspectWorktree = async (session: Session) => {
    const result = await call(() => window.inova.getWorktreeStatus({ sessionId: session.id }));
    if (result) setWorktreeModal({ session, status: result.value });
  };

  const applyWorktree = async (session: Session) => {
    const result = await call(() => window.inova.applyWorktree({ sessionId: session.id }));
    if (!result) return;
    setWorktreeModal(null);
  };

  const confirmRestoreCheckpoint = async (target: {
    sessionId: string;
    ref: string;
    skippedLargeFiles: string[];
  }) => {
    const result = await call(() =>
      window.inova.restoreCheckpoint({
        sessionId: target.sessionId,
        ref: target.ref,
        preserveFiles: target.skippedLargeFiles,
      }),
    );
    if (!result) return;
  };

  const updateProjectVerification = async (
    projectId: string,
    patch: {
      autoWorktree?: boolean;
      autoVerify?: boolean;
      verificationChecks?: VerificationCheck[];
    },
  ) => {
    const result = await call(() =>
      window.inova.updateProjectVerification({ projectId, ...patch }),
    );
    if (!result) return;
    setProjects((current) =>
      current.map((item) => (item.id === result.value.id ? result.value : item)),
    );
  };

  const detectChecks = async (project: ProjectView) => {
    const detected = await call(() => window.inova.detectProjectChecks({ projectId: project.id }));
    if (!detected) return;
    const existing = project.verificationChecks ?? [];
    const knownIds = new Set(existing.map((c) => c.id));
    const merged = [...existing, ...detected.value.filter((c) => !knownIds.has(c.id))];
    await updateProjectVerification(project.id, { verificationChecks: merged });
  };

  const runVerification = async (sessionId: string) => {
    await call(() => window.inova.runVerification({ sessionId }));
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
    patch: { model?: string | null; effort?: EffortLevel | null; mode?: ExecutionMode | null };
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

  const setDefaultProviderMode = async (provider: ProviderId, mode: ExecutionMode) => {
    const result = await call(() => window.inova.setDefaultMode({ provider, mode }));
    if (result) setDefaultModes(result.value);
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

  const startSession = async (input: {
    target: NewSessionTarget;
    prompt: string;
    isolatedWorktree?: boolean;
  }) => {
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
    const session = await newSession({
      project,
      parent: null,
      isolatedWorktree: input.isolatedWorktree,
    });
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

  const startComparison = useCallback(
    async (input: {
      projectId: string;
      prompt: string;
      leftAccountId: string;
      rightAccountId: string;
      leftModel?: string | null;
      leftEffort?: EffortLevel | null;
      leftMode?: ExecutionMode | null;
      rightModel?: string | null;
      rightEffort?: EffortLevel | null;
      rightMode?: ExecutionMode | null;
    }): Promise<string | null> => {
      const result = await call(() => window.inova.startComparison(input));
      if (!result) return null;
      await reloadSessions(input.projectId);
      setSelectedComparisonGroupId(result.value.groupId);
      return result.value.groupId;
    },
    [call, reloadSessions],
  );

  const getComparisonDiff = useCallback(
    async (groupId: string): Promise<ComparisonDiffView | null> => {
      const result = await call(() => window.inova.getComparisonDiff({ groupId }));
      return result?.value ?? null;
    },
    [call],
  );

  const resolveComparison = useCallback(
    async (input: {
      groupId: string;
      winner: 'left' | 'right';
      cleanupWorktrees: boolean;
    }): Promise<boolean> => {
      const result = await call(() => window.inova.resolveComparison(input));
      if (!result) return false;
      const projectId = Object.keys(latest.current.sessions).find((id) =>
        latest.current.sessions[id]?.some((session) => session.comparisonGroupId === input.groupId),
      );
      if (projectId) await reloadSessions(projectId);
      return true;
    },
    [call, reloadSessions],
  );

  const previewProfileSync = useCallback(
    async (input: {
      projectId: string;
      accountIds?: string[];
      rulesSource?: RulesFile | null;
    }): Promise<ProfileSyncPreview | null> => {
      const result = await call(() => window.inova.previewProfileSync(input));
      return result?.value ?? null;
    },
    [call],
  );

  const applyProfileSync = useCallback(
    async (input: {
      projectId: string;
      accountIds?: string[];
      rulesSource?: RulesFile | null;
      approvedIds: string[];
      rulesStrategy: RulesStrategy;
    }): Promise<ProfileSyncApplyResult | null> => {
      const result = await call(() => window.inova.applyProfileSync(input));
      return result?.value ?? null;
    },
    [call],
  );

  const accountDisplayOf = (
    account: AccountView | undefined,
    project: ProjectView | undefined,
  ): string | null => {
    if (account) {
      return accountDisplayName({ label: account.label, email: account.email });
    }
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
  const activeAccount = effectiveAccountOf(activeSession, activeProject);
  const chatTabs = tabs.tabs.filter((tab) => tab.kind === 'chat');
  const activeAccountLabel = activeAccount?.label ?? activeProject?.accountLabel ?? null;

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
          inboxItems={inboxItems}
          activeSessionId={inWorkspace ? tabs.active : null}
          statusOf={(sessionId) => sessionStatus(chats[sessionId])}
          onOpenInboxItem={(sessionId) => {
            const target = sessionById.get(sessionId);
            if (target) void openChatTab(target);
            else void call(() => window.inova.markInboxRead({ sessionId }));
          }}
          onClearReadInbox={() => {
            void call(() => window.inova.clearReadInbox()).then((res) => {
              if (res) setInboxItems(res.value);
            });
          }}
          onOpenSession={(session) => void openChatTab(session)}
          onNewSession={(input) => void newSession(input)}
          onOpenProfileSync={(project) => setProfileSyncProject(project)}
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
                const session = sessionById.get(tab.sessionId);
                const project = projectOf(tab.sessionId);
                const account = effectiveAccountOf(session, project);
                return {
                  sessionId: tab.sessionId,
                  title: tab.title,
                  provider: account?.provider ?? tab.provider,
                  where: project
                    ? `${folderName(project.path)} · ${accountDisplayOf(account, project)}`
                    : '',
                  status: sessionStatus(chats[tab.sessionId]),
                  tail: agentTail({ items: chats[tab.sessionId]?.items ?? [], lines: 3 }),
                };
              })}
              onOpen={(sessionId) => {
                setView('workspace');
                dispatch({ type: 'activate', sessionId });
                void window.inova.markInboxRead({ sessionId });
              }}
              onNewSession={() => setView('new-session')}
            />
          )}
          {view === 'compare' && (
            <CompareView
              projects={projects}
              accounts={accounts}
              sessions={sessions}
              chats={chats}
              compareMetrics={compareMetrics}
              selectedGroupId={selectedComparisonGroupId}
              onSelectGroup={setSelectedComparisonGroupId}
              onStartComparison={startComparison}
              onGetDiff={getComparisonDiff}
              onResolveComparison={resolveComparison}
              onOpenSession={(session) => void openChatTab(session)}
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
                provider={activeAccount?.provider ?? activeTab.provider}
                accountDisplay={accountDisplayOf(activeAccount, activeProject)}
                path={activeProject?.path ?? null}
                worktreeBranch={activeSession?.worktree?.branch ?? null}
                worktreeBusy={
                  activeTab.kind === 'chat' ? Boolean(chats[activeTab.sessionId]?.running) : false
                }
                status={
                  activeTab.kind === 'chat' ? sessionStatus(chats[activeTab.sessionId]) : null
                }
                exited={activeTab.exited}
                onRename={
                  activeSession
                    ? (title) => void renameSession({ session: activeSession, title })
                    : undefined
                }
                onInspectWorktree={
                  activeSession?.worktree ? () => void inspectWorktree(activeSession) : undefined
                }
                onApplyWorktree={
                  activeSession?.worktree ? () => void applyWorktree(activeSession) : undefined
                }
                onHandoff={activeSession ? () => setPendingHandoff(activeSession) : undefined}
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
              const tabAccount = effectiveAccountOf(tabSession, tabProject);
              const tabProvider = tabAccount?.provider ?? tab.provider;
              const tabAccountLabel = tabAccount?.label ?? tabProject?.accountLabel;
              const tabCatalog =
                (tabAccountLabel ? modelsByAccount[tabAccountLabel] : undefined) ??
                PROVIDER_MODELS[tabProvider ?? 'claude'];
              const tabState = chats[tab.sessionId] ?? initialChatState;
              const tabQueuedTurns = turnQueue.filter((item) => item.sessionId === tab.sessionId);
              const alternativeAccounts = accounts.filter(
                (candidate) => candidate.id !== tabAccount?.id,
              );
              return (
                <ChatView
                  key={tab.sessionId}
                  sessionId={tab.sessionId}
                  projectId={tabProject?.id ?? null}
                  state={tabState}
                  visible={inWorkspace && tab.sessionId === tabs.active}
                  provider={tabProvider}
                  accountDisplay={accountDisplayOf(tabAccount, tabProject)}
                  model={tabSession?.model ?? null}
                  effort={tabSession?.effort ?? null}
                  mode={tabSession?.mode ?? null}
                  defaultModes={defaultModes}
                  inWorktree={Boolean(tabSession?.worktree)}
                  catalog={tabCatalog}
                  readOnly={archivedIds.has(tab.sessionId)}
                  queuedTurns={tabQueuedTurns}
                  busyConflict={busyConflicts[tab.sessionId] ?? null}
                  alternativeAccounts={alternativeAccounts}
                  onChangeModelConfig={(patch) =>
                    void updateSessionModelConfig({ sessionId: tab.sessionId, patch })
                  }
                  onChangeMode={(mode) =>
                    void updateSessionModelConfig({ sessionId: tab.sessionId, patch: { mode } })
                  }
                  onSetDefaultMode={(mode) => {
                    if (tabProvider) void setDefaultProviderMode(tabProvider, mode);
                  }}
                  onRestoreCheckpoint={(cp) =>
                    setPendingRestore({
                      sessionId: tab.sessionId,
                      ref: cp.ref,
                      skippedLargeFiles: cp.skippedLargeFiles,
                    })
                  }
                  onForkTurn={
                    tabSession
                      ? (turnIndex) => {
                          const totalUserTurns = tabState.items.filter(
                            (item) => item.type === 'user',
                          ).length;
                          setPendingFork({
                            session: tabSession,
                            turnIndex,
                            isLatestTurn: turnIndex >= totalUserTurns - 1,
                          });
                        }
                      : undefined
                  }
                  onOpenHandoff={tabSession ? () => setPendingHandoff(tabSession) : undefined}
                  onEnqueuePrompt={(prompt) => void enqueuePrompt(tab.sessionId, prompt)}
                  onCancelQueuedTurn={(turnId) => void cancelQueuedTurn(turnId)}
                  onSwitchAccountAndRetry={({ accountId, prompt }) =>
                    void switchAccountAndRetry({
                      sessionId: tab.sessionId,
                      accountId,
                      prompt,
                    })
                  }
                  onDismissBusyConflict={() => clearBusyConflict(tab.sessionId)}
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
            account={activeAccount}
            usage={activeAccountLabel ? usage[activeAccountLabel] : undefined}
            running={Boolean(chats[activeSession.id]?.running)}
            onDetectChecks={() => void detectChecks(activeProject)}
            onRunVerification={() => void runVerification(activeSession.id)}
            onUpdateProjectVerification={(patch) =>
              void updateProjectVerification(activeProject.id, patch)
            }
          />
        )}
      </div>
      <Footer
        accounts={accounts}
        focusedAccountLabel={inWorkspace ? activeAccountLabel : null}
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
      {pendingRestore && (
        <ConfirmModal
          title="Restaurar checkpoint"
          description={
            pendingRestore.skippedLargeFiles.length > 0
              ? `Restaurar os arquivos do repositório ao estado anterior a este turno? Arquivos acima de 10 MB preservados: ${pendingRestore.skippedLargeFiles.join(', ')}.`
              : 'Restaurar os arquivos do repositório ao estado anterior a este turno? Alterações posteriores neste worktree serão substituídas.'
          }
          confirmLabel="Restaurar"
          danger
          onCancel={() => setPendingRestore(null)}
          onConfirm={() => {
            const target = pendingRestore;
            setPendingRestore(null);
            void confirmRestoreCheckpoint(target);
          }}
        />
      )}
      {pendingForceDelete && (
        <ConfirmModal
          title="Descartar alterações do worktree"
          description={`A sessão "${pendingForceDelete.title}" possui alterações não aplicadas no worktree. Apagar a sessão descartará essas alterações.`}
          confirmLabel="Apagar e descartar"
          danger
          onCancel={() => setPendingForceDelete(null)}
          onConfirm={() => {
            const target = pendingForceDelete;
            setPendingForceDelete(null);
            void deleteSession(target, true);
          }}
        />
      )}
      {worktreeModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="worktree-diff-title"
          onClick={() => setWorktreeModal(null)}
        >
          <div className="modal modal-wide" onClick={(event) => event.stopPropagation()}>
            <h2 id="worktree-diff-title" className="modal-title">
              Alterações do worktree ({worktreeModal.status.branch})
            </h2>
            {worktreeModal.status.changedFiles.length === 0 ? (
              <p className="modal-body">Nenhuma alteração pendente em relação à base.</p>
            ) : (
              <>
                <p className="modal-body mono">{worktreeModal.status.diffStat}</p>
                <pre className="worktree-diff-pre">{worktreeModal.status.diff}</pre>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setWorktreeModal(null)}>
                Fechar
              </button>
              {worktreeModal.status.changedFiles.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={Boolean(chats[worktreeModal.session.id]?.running)}
                  onClick={() => void applyWorktree(worktreeModal.session)}
                >
                  Aplicar no projeto principal
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
      {pendingFork && (
        <ForkModal
          session={pendingFork.session}
          turnIndex={pendingFork.turnIndex}
          isLatestTurn={pendingFork.isLatestTurn}
          sourceAccount={effectiveAccountOf(pendingFork.session, projectOf(pendingFork.session.id))}
          accounts={accounts}
          onCancel={() => setPendingFork(null)}
          onConfirm={({ targetAccountId, copyWorktreeFiles }) => {
            const target = pendingFork;
            setPendingFork(null);
            void confirmForkSession({
              session: target.session,
              turnIndex: target.turnIndex,
              ...(targetAccountId ? { targetAccountId } : {}),
              copyWorktreeFiles,
            });
          }}
        />
      )}
      {pendingHandoff && (
        <HandoffModal
          session={pendingHandoff}
          sourceAccount={effectiveAccountOf(pendingHandoff, projectOf(pendingHandoff.id))}
          accounts={accounts}
          onCancel={() => setPendingHandoff(null)}
          onConfirm={({ targetAccountId, createWorktree }) => {
            const target = pendingHandoff;
            setPendingHandoff(null);
            void confirmHandoffSession({
              session: target,
              targetAccountId,
              createWorktree,
            });
          }}
        />
      )}
      {profileSyncProject && (
        <ProfileSyncModal
          project={profileSyncProject}
          accounts={accounts}
          onPreview={previewProfileSync}
          onApply={applyProfileSync}
          onClose={() => setProfileSyncProject(null)}
        />
      )}
    </div>
  );
}
