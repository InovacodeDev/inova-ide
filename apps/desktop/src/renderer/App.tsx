import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { TurnTokenUsage } from '@inova/core/chat-types';
import {
  aggregateTranscriptUsage,
  sumSessionUsageTotals,
  type TurnUsageEntry,
} from '@inova/core/cost-tracking';
import { MAX_PINNED_MEMORY_CHARS, buildParentFixPrompt } from '@inova/core/handoff';
import { PROVIDER_MODELS, resolveModelConfig, type ProviderModels } from '@inova/core/models';
import { PROVIDER_MODES, resolveExecutionMode } from '@inova/core/modes';
import { nativeSlashCommands } from '@inova/core/slash-commands';
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
import { SESSION_EXPIRED_USAGE_MESSAGE } from '../shared/api';
import { AccountsView } from './AccountsView';
import { agentTail } from './agent-tail';
import { AgentsView } from './AgentsView';
import { ChatView, type ChatViewHandle } from './ChatView';
import { buildCommandPaletteItems, type CommandPaletteItem } from './command-palette-state';
import { CommandPaletteModal } from './CommandPaletteModal';
import { CompareView } from './CompareView';
import { ConfirmModal } from './ConfirmModal';
import { chatStoreReducer } from './chat-store';
import { initialChatState } from './chat-reducer';
import { collectVoiceHints } from './dictation';
import { Footer, type UsageState } from './Footer';
import { ForkModal } from './ForkModal';
import { buildFailoverNotice, type FailoverNotice } from './failover-notice';
import { HandoffModal } from './HandoffModal';
import { ImportSessionModal, type ImportRequest } from './ImportSessionModal';
import { Header } from './Header';
import { AlertIcon, CloseIcon } from './icons';
import { ProviderBadge } from './ProviderBadge';
import { LoginModal, type LoginModalState } from './LoginModal';
import { NewSessionView, type NewSessionTarget } from './NewSessionView';
import { ProfileSyncModal } from './ProfileSyncModal';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { accountDisplayName, PROVIDER_NAME } from './provider-meta';
import { SessionDetails } from './SessionDetails';
import { SessionDiffModal } from './SessionDiffModal';
import { SessionHeader } from './SessionHeader';
import { isAccountBusyElsewhere } from './queue-state';
import { sessionStatus } from './session-status';
import { SettingsModal } from './SettingsModal';
import { ChangelogModal } from './ChangelogModal';
import { I18nProvider } from './I18nContext';
import { resolveLocale, translate, type TranslationKey, type TranslationParams } from './i18n';
import { modeOptionText } from './mode-picker-state';
import { localizeModelOption } from './model-picker-state';
import { UpdateProgress } from './UpdateProgress';
import { UpdateToast } from './UpdateToast';
import { useUpdates } from './useUpdates';
import { refreshableUsageLabels, settleUsage, USAGE_REFRESH_INTERVAL_MS } from './usage-refresh';
import { isMacPlatform, type ShortcutCommand } from './shortcuts';
import { Sidebar, type View } from './Sidebar';
import {
  adjacentSessionId,
  initialTabsState,
  tabsReducer,
  visibleSessionIds,
  type Tab,
} from './tabs';
import { TooltipLayer } from './TooltipLayer';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { useSettings } from './useSettings';
import { useTheme } from './useTheme';
import { useWarning } from './useWarning';
import { restoreTabs, workspaceFromTabs, workspaceKey } from './workspace';

const SAVE_DEBOUNCE_MS = 300;
const IS_MAC = isMacPlatform(navigator.platform);

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
  const usageInflightRef = useRef<Set<string>>(new Set());
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
    initialFilePath: string | null;
  } | null>(null);
  const [gitRevision, setGitRevision] = useState(0);
  const [revertingFiles, setRevertingFiles] = useState(false);
  const [reviewingDiff, setReviewingDiff] = useState(false);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [turnQueue, setTurnQueue] = useState<QueuedTurn[]>([]);
  const [pausedQueueIds, setPausedQueueIds] = useState<string[]>([]);
  const [busyConflicts, setBusyConflicts] = useState<
    Record<string, { prompt: string; exhausted: boolean; message?: string; extraDirs?: string[] }>
  >({});
  const [failoverNotices, setFailoverNotices] = useState<Record<string, FailoverNotice>>({});
  const [pendingRevert, setPendingRevert] = useState<{
    session: Session;
    files: string[];
  } | null>(null);
  const [pendingFork, setPendingFork] = useState<{
    session: Session;
    turnIndex: number;
    isLatestTurn: boolean;
  } | null>(null);
  const [pendingRewind, setPendingRewind] = useState<{
    sessionId: string;
    turnIndex: number;
    resend?: { extraDirs: string[] };
  } | null>(null);
  const [pendingComposerText, setPendingComposerText] = useState<Record<string, string>>({});
  const [pendingCompactContinue, setPendingCompactContinue] = useState<Record<string, string>>({});
  const [pendingHandoff, setPendingHandoff] = useState<Session | null>(null);
  const [selectedComparisonGroupId, setSelectedComparisonGroupId] = useState<string | null>(null);
  const [profileSyncProject, setProfileSyncProject] = useState<ProjectView | null>(null);
  const [projectSettingsId, setProjectSettingsId] = useState<string | null>(null);
  const [importProject, setImportProject] = useState<ProjectView | null>(null);
  const [applyingWorktree, setApplyingWorktree] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [compareMetrics, setCompareMetrics] = useState<
    Record<string, { costUsd: number | null; durationMs: number | null }>
  >({});
  const [turnUsagesBySession, setTurnUsagesBySession] = useState<Record<string, TurnUsageEntry[]>>(
    {},
  );
  const pendingTurnUsageRef = useRef(
    new Map<string, { promptPreview: string; usage: TurnTokenUsage | null }>(),
  );
  const [windowFocused, setWindowFocused] = useState(() =>
    typeof document !== 'undefined' ? document.hasFocus() : true,
  );
  const {
    warning,
    history: warningHistory,
    dismiss,
    clearHistory: clearWarningHistory,
    setLocale: setWarningLocale,
    guard,
    call,
    warn,
  } = useWarning();
  const updates = useUpdates(call);
  const [confirmUpdateRestart, setConfirmUpdateRestart] = useState(false);
  const { settings, update: updateSettings } = useSettings(call);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<Session | null>(null);
  const inboxRef = useRef<HTMLElement>(null);
  const activeChatRef = useRef<ChatViewHandle>(null);
  useTheme(settings?.appearance.theme);
  const locale = resolveLocale(settings?.appearance.locale, navigator.language);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  useEffect(() => {
    setWarningLocale(locale);
  }, [locale, setWarningLocale]);
  const t = (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params);
  const sidebarCollapsed = settings?.appearance.sidebarCollapsed ?? false;
  const detailsCollapsed = settings?.appearance.detailsCollapsed ?? false;
  const [tabs, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [chats, dispatchChat] = useReducer(chatStoreReducer, {});

  const latest = useRef({ accounts, projects, sessions, chats, tabs });
  useEffect(() => {
    latest.current = { accounts, projects, sessions, chats, tabs };
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

  const loadUsage = useCallback(
    async (accountLabel: string, background = false) => {
      usageInflightRef.current.add(accountLabel);
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
        const known = latest.current.accounts.find((account) => account.label === accountLabel);
        const expiredNow = !result.ok && result.message === SESSION_EXPIRED_USAGE_MESSAGE;
        const recovered = result.ok && known?.status === 'expired';
        if ((expiredNow && known?.status !== 'expired') || recovered) void reloadAccounts();
      } catch (error: unknown) {
        console.error('inova: unexpected renderer error', error);
        next = { status: 'error', message: 'Erro inesperado.' };
      } finally {
        usageInflightRef.current.delete(accountLabel);
      }
      setUsage((current) => ({
        ...current,
        [accountLabel]: settleUsage({ current: current[accountLabel], next, background }),
      }));
    },
    [reloadAccounts],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      refreshableUsageLabels(latest.current.accounts, usageInflightRef.current).forEach((label) => {
        void loadUsage(label, true);
      });
    }, USAGE_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadUsage]);

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
    async (sessionId: string, mode: 'load' | 'replace' = 'load') => {
      const result = await call(() => window.inova.loadTranscript({ sessionId }));
      if (result) {
        dispatchChat({ sessionId, action: { type: mode, events: result.value } });
        setTurnUsagesBySession((current) => ({
          ...current,
          [sessionId]: aggregateTranscriptUsage(result.value).turnEntries,
        }));
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
    void call(() => window.inova.listPausedQueues()).then((loadedPaused) => {
      if (loadedPaused) setPausedQueueIds(loadedPaused.value);
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
      if (event.kind === 'user') {
        dispatchChat({ sessionId, action: { type: 'started' } });
        const firstLine =
          event.text
            .split('\n')
            .find((line) => line.trim() !== '')
            ?.trim() ?? '';
        const promptPreview = firstLine.length <= 72 ? firstLine : `${firstLine.slice(0, 71)}…`;
        pendingTurnUsageRef.current.set(sessionId, { promptPreview, usage: null });
      }
      if (event.kind === 'turn-usage') {
        const current = pendingTurnUsageRef.current.get(sessionId) ?? {
          promptPreview: '',
          usage: null,
        };
        current.usage = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
          cacheWriteTokens: event.cacheWriteTokens,
        };
        pendingTurnUsageRef.current.set(sessionId, current);
      }
      dispatchChat({ sessionId, action: { type: 'event', event } });
      if (event.kind !== 'done') return;
      const pendingTurn = pendingTurnUsageRef.current.get(sessionId);
      pendingTurnUsageRef.current.delete(sessionId);
      setTurnUsagesBySession((current) => {
        const previous = current[sessionId] ?? [];
        const entry: TurnUsageEntry = {
          turnIndex: previous.length,
          promptPreview: pendingTurn?.promptPreview ?? '',
          isError: event.isError,
          costUsd: event.costUsd,
          durationMs: event.durationMs,
          inputTokens: pendingTurn?.usage?.inputTokens ?? 0,
          outputTokens: pendingTurn?.usage?.outputTokens ?? 0,
          cacheReadTokens: pendingTurn?.usage?.cacheReadTokens ?? 0,
          cacheWriteTokens: pendingTurn?.usage?.cacheWriteTokens ?? 0,
        };
        return { ...current, [sessionId]: [...previous, entry] };
      });
      if (event.isError) void reloadAccounts();
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
  }, [reloadSessions, loadUsage, reloadAccounts]);

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
    return window.inova.onQueuePausedEvent((sessionIds) => setPausedQueueIds(sessionIds));
  }, []);

  useEffect(() => {
    return window.inova.onFailoverEvent(
      ({ session, rollbackLastTurn, fromAccountId, toAccountId }) => {
        const prevProject = latest.current.projects.find((item) => item.id === session.projectId);
        const prevSession = (latest.current.sessions[session.projectId] ?? []).find(
          (item) => item.id === session.id,
        );
        const resolvedFromId =
          fromAccountId ??
          prevSession?.accountIdOverride ??
          latest.current.accounts.find((item) => item.label === prevProject?.accountLabel)?.id ??
          null;
        const fromAccount = resolvedFromId
          ? latest.current.accounts.find((item) => item.id === resolvedFromId)
          : undefined;
        const resolvedToId = toAccountId ?? session.accountIdOverride;
        const toAccount = resolvedToId
          ? latest.current.accounts.find((item) => item.id === resolvedToId)
          : undefined;
        setSessions((current) => {
          const list = current[session.projectId] ?? [];
          const exists = list.some((item) => item.id === session.id);
          return {
            ...current,
            [session.projectId]: exists
              ? list.map((item) => (item.id === session.id ? session : item))
              : [...list, session],
          };
        });
        setFailoverNotices((current) => ({
          ...current,
          [session.id]: buildFailoverNotice({
            fromAccount,
            toAccount,
            rollbackLastTurn,
            locale: localeRef.current,
          }),
        }));
        if (toAccount) {
          dispatch({ type: 'rebind', sessionId: session.id, provider: toAccount.provider });
        }
        setBusyConflicts((current) => {
          if (!(session.id in current)) return current;
          const next = { ...current };
          delete next[session.id];
          return next;
        });
        if (rollbackLastTurn) {
          dispatchChat({ sessionId: session.id, action: { type: 'rollback-last-turn' } });
        }
        void reloadAccounts();
      },
    );
  }, [reloadAccounts]);

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

  const listExternalSessions = useCallback(
    (projectId: string) => window.inova.listExternalSessions({ projectId }),
    [],
  );

  const importSessions = async (input: { project: ProjectView; requests: ImportRequest[] }) => {
    const imported: Session[] = [];
    for (const request of input.requests) {
      const result = await call(() =>
        window.inova.importSessions({ projectId: input.project.id, ...request }),
      );
      if (!result) break;
      imported.push(...result.value);
    }
    await reloadSessions(input.project.id);
    const first = imported[0];
    if (!first) return;
    setImportProject(null);
    await openChatTab(first, input.project);
  };

  const sendMessage = async (
    sessionId: string,
    prompt: string,
    extraDirs: string[] = [],
  ): Promise<boolean> => {
    dispatchChat({ sessionId, action: { type: 'started' } });
    const result = await guard(() => window.inova.sendMessage({ sessionId, prompt, extraDirs }));
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
            [sessionId]: {
              prompt,
              exhausted: false,
              ...(extraDirs.length > 0 ? { extraDirs } : {}),
            },
          }));
        } else if (result.message.startsWith('CONTA_ESGOTADA:')) {
          const message = result.message.slice('CONTA_ESGOTADA:'.length).trim();
          setBusyConflicts((current) => ({
            ...current,
            [sessionId]: { prompt, exhausted: true, message },
          }));
        } else {
          await call(() => Promise.resolve(result));
        }
      }
      return false;
    }
    if (busyConflicts[sessionId]?.exhausted) {
      const { sessions: knownSessions, projects: knownProjects } = latest.current;
      const projectId = Object.keys(knownSessions).find((id) =>
        knownSessions[id]?.some((item) => item.id === sessionId),
      );
      const session = projectId
        ? knownSessions[projectId]?.find((item) => item.id === sessionId)
        : undefined;
      const project = knownProjects.find((candidate) => candidate.id === projectId);
      const account = effectiveAccountOf(session, project);
      if (account) void loadUsage(account.label);
    }
    setBusyConflicts((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    return true;
  };

  const clearBusyConflict = (sessionId: string) => {
    setBusyConflicts((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  };

  const enqueuePrompt = async (input: {
    sessionId: string;
    prompt: string;
    extraDirs?: string[];
  }) => {
    const { sessionId, prompt, extraDirs } = input;
    const result = await call(() =>
      window.inova.enqueueTurn({ sessionId, prompt, ...(extraDirs ? { extraDirs } : {}) }),
    );
    if (result) clearBusyConflict(sessionId);
  };

  const resumeQueue = async (sessionId: string) => {
    const result = await guard(() => window.inova.resumeSessionQueue({ sessionId }));
    if (!result || result.ok) return;
    if (result.message.startsWith('CONTA_ESGOTADA:')) {
      const message = result.message.slice('CONTA_ESGOTADA:'.length).trim();
      const prompt = turnQueue.find((item) => item.sessionId === sessionId)?.prompt ?? '';
      setBusyConflicts((current) => ({
        ...current,
        [sessionId]: { prompt, exhausted: true, message },
      }));
      return;
    }
    await call(() => Promise.resolve(result));
  };

  const cancelQueuedTurn = async (turnId: string) => {
    await call(() => window.inova.cancelQueuedTurn({ turnId }));
  };

  const clearFailoverNotice = (sessionId: string) =>
    setFailoverNotices((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });

  const revertFailoverAccount = async (sessionId: string, accountId: string) => {
    const switched = await call(() =>
      window.inova.switchSessionAccount({
        sessionId,
        accountId,
        generateHandoff: true,
      }),
    );
    if (!switched) return;
    clearFailoverNotice(sessionId);
    const updated = switched.value.session;
    const matched = accounts.find((candidate) => candidate.id === accountId);
    await reloadSessions(updated.projectId);
    dispatch({
      type: 'rebind',
      sessionId: updated.id,
      provider: matched?.provider ?? null,
    });
    if (matched) {
      setNotice(
        translate(localeRef.current, 'app.returnedSessionNotice', {
          provider: PROVIDER_NAME[matched.provider],
          account: accountDisplayName(matched),
        }),
      );
    }
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
    clearFailoverNotice(input.sessionId);
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
    dispatch({
      type: 'rebind',
      sessionId: updated.id,
      provider: matched?.provider ?? null,
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

  const seedComposer = (sessionId: string, text: string) =>
    setPendingComposerText((current) => ({ ...current, [sessionId]: text }));

  useEffect(() => {
    const finished = Object.entries(pendingCompactContinue).filter(
      ([sessionId]) => chats[sessionId]?.running === false,
    );
    if (finished.length === 0) return;
    const seeds = finished.filter(
      ([sessionId]) => chats[sessionId]?.items.at(-1)?.type !== 'error',
    );
    setPendingCompactContinue((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([sessionId]) =>
          finished.every(([doneId]) => doneId !== sessionId),
        ),
      ),
    );
    if (seeds.length > 0) {
      setPendingComposerText((current) => ({ ...current, ...Object.fromEntries(seeds) }));
    }
  }, [chats, pendingCompactContinue]);

  const confirmRewindTurn = async (input: { sessionId: string; turnIndex: number }) => {
    const result = await call(() => window.inova.rewindSession(input));
    if (!result) return;
    await loadChat(input.sessionId, 'replace');
    seedComposer(input.sessionId, result.value.text);
  };

  const clearConversation = async (sessionId: string) => {
    const result = await call(() => window.inova.clearSession({ sessionId }));
    if (!result) return;
    await loadChat(sessionId, 'replace');
  };

  const continuePromptFor = (sessionId: string): string => {
    const lastRequest = (latest.current.chats[sessionId]?.items ?? [])
      .flatMap((item) => (item.type === 'user' ? [item.text.trim()] : []))
      .filter((text) => text !== '')
      .at(-1);
    return lastRequest === undefined
      ? t('chat.continuePrompt')
      : t('chat.continuePromptWithRequest', { request: lastRequest });
  };

  const clearAndContinue = async (sessionId: string) => {
    const prompt = continuePromptFor(sessionId);
    const result = await call(() => window.inova.clearSession({ sessionId, keepContext: true }));
    if (!result) return;
    await loadChat(sessionId, 'replace');
    seedComposer(sessionId, prompt);
  };

  const compactAndContinue = async (sessionId: string) => {
    const prompt = continuePromptFor(sessionId);
    if (!(await sendMessage(sessionId, '/compact'))) return;
    setPendingCompactContinue((current) => ({ ...current, [sessionId]: prompt }));
  };

  const regenerateLastTurn = async (input: { sessionId: string; extraDirs: string[] }) => {
    const { sessionId, extraDirs } = input;
    const userTurns = (chats[sessionId]?.items ?? []).filter((item) => item.type === 'user');
    if (userTurns.length === 0) return;
    const result = await call(() =>
      window.inova.rewindSession({ sessionId, turnIndex: userTurns.length - 1 }),
    );
    if (!result) return;
    await loadChat(sessionId, 'replace');
    const sent = await sendMessage(sessionId, result.value.text, extraDirs);
    if (!sent) seedComposer(sessionId, result.value.text);
  };

  const recordFeedback = async (input: {
    sessionId: string;
    turnIndex: number;
    value: 'up' | 'down' | null;
  }) => {
    const result = await call(() => window.inova.recordFeedback(input));
    if (!result) return;
    dispatchChat({
      sessionId: input.sessionId,
      action: {
        type: 'event',
        event: { kind: 'feedback', turnIndex: input.turnIndex, value: input.value },
      },
    });
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!worktreeModal || pendingRevert) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setWorktreeModal(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [worktreeModal, pendingRevert]);

  const confirmHandoffSession = async (input: {
    session: Session;
    targetAccountId: string;
    createWorktree: boolean;
  }) => {
    const pendingPrompt = busyConflicts[input.session.id]?.prompt;
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
    if (pendingPrompt) {
      await sendMessage(created.id, pendingPrompt);
    }
  };

  const reviewSessionDiff = async (session: Session) => {
    if (reviewingDiff) return;
    setReviewingDiff(true);
    try {
      const res = await window.inova.reviewSessionDiff({ sessionId: session.id });
      if (!res.ok) {
        setNotice(res.message);
        return;
      }
      setWorktreeModal(null);
      await reloadSessions(res.value.session.projectId);
      await openChatTab(res.value.session);
      await sendMessage(res.value.session.id, res.value.prompt);
    } finally {
      setReviewingDiff(false);
    }
  };

  const sendFindingsToParent = async (childSession: Session, findings: string) => {
    if (!childSession.parentId) return;
    const projectSessions = latest.current.sessions[childSession.projectId] ?? [];
    const parent = projectSessions.find(
      (item) => item.id === childSession.parentId && item.archivedAt === null,
    );
    if (!parent) {
      setNotice(translate(localeRef.current, 'app.parentNotFoundNotice'));
      return;
    }
    await openChatTab(parent);
    seedComposer(parent.id, buildParentFixPrompt(findings));
    setNotice(translate(localeRef.current, 'app.sentToParentNotice'));
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
          ? {
              ...current,
              stage: 'failed',
              message: translate(localeRef.current, 'app.authStartFailed'),
            }
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

  const requestCloseTab = (tab: Tab) => {
    if (latest.current.chats[tab.sessionId]?.running) setPendingCloseTab(tab);
    else closeTab(tab);
  };

  const activateTab = (sessionId: string) => {
    setView('workspace');
    dispatch({ type: 'activate', sessionId });
    void window.inova.markInboxRead({ sessionId });
  };

  const splitTab = (sessionId: string) => {
    setView('workspace');
    dispatch({ type: 'split', sessionId });
    void window.inova.markInboxRead({ sessionId });
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

  const inspectWorktree = async (session: Session, initialFilePath?: string) => {
    const result = await call(() => window.inova.getWorktreeStatus({ sessionId: session.id }));
    if (result) {
      setWorktreeModal({
        session,
        status: result.value,
        initialFilePath: initialFilePath ?? null,
      });
    }
  };

  const applyWorktree = async (session: Session) => {
    setApplyingWorktree(true);
    try {
      const result = await call(() => window.inova.applyWorktree({ sessionId: session.id }));
      if (!result) return;
      setWorktreeModal(null);
      setGitRevision((revision) => revision + 1);
      setNotice(
        translate(localeRef.current, 'app.appliedWorktreeNotice', {
          count: result.value.appliedFiles.length,
        }),
      );
    } finally {
      setApplyingWorktree(false);
    }
  };

  const revertSessionFiles = async (session: Session, files: string[]): Promise<boolean> => {
    if (files.length === 0) return false;
    setRevertingFiles(true);
    try {
      const result = await call(() =>
        window.inova.restoreCheckpoint({ sessionId: session.id, files }),
      );
      if (!result) return false;
      setGitRevision((revision) => revision + 1);
      const refreshed = await window.inova.getWorktreeStatus({ sessionId: session.id });
      if (refreshed.ok) {
        setWorktreeModal((current) =>
          current && current.session.id === session.id
            ? { ...current, status: refreshed.value }
            : current,
        );
      }
      setNotice(
        files.length === 1
          ? translate(localeRef.current, 'app.revertedSingleNotice', { file: files[0] ?? '' })
          : translate(localeRef.current, 'app.revertedMultiNotice', { count: files.length }),
      );
      return true;
    } finally {
      setRevertingFiles(false);
    }
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
    setGitRevision((revision) => revision + 1);
    setNotice(translate(localeRef.current, 'app.restoredCheckpointNotice'));
  };

  const updateProjectVerification = async (
    projectId: string,
    patch: {
      autoWorktree?: boolean;
      autoVerify?: boolean;
      verificationChecks?: VerificationCheck[];
      pinnedMemory?: string | null;
    },
  ): Promise<boolean> => {
    const result = await call(() =>
      window.inova.updateProjectVerification({ projectId, ...patch }),
    );
    if (!result) return false;
    setProjects((current) =>
      current.map((item) => (item.id === result.value.id ? result.value : item)),
    );
    return true;
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
    patch: {
      model?: string | null;
      effort?: EffortLevel | null;
      mode?: ExecutionMode | null;
      pinnedMemory?: string | null;
    };
  }): Promise<boolean> => {
    const result = await call(() =>
      window.inova.updateSession({ sessionId: input.sessionId, ...input.patch }),
    );
    if (!result) return false;
    const updated = result.value;
    setSessions((current) => ({
      ...current,
      [updated.projectId]: (current[updated.projectId] ?? []).map((item) =>
        item.id === updated.id ? updated : item,
      ),
    }));
    return true;
  };

  const updateProjectPinnedMemory = async (projectId: string, pinnedMemory: string | null) => {
    const saved = await updateProjectVerification(projectId, { pinnedMemory });
    if (!saved) return;
    setNotice(
      translate(
        localeRef.current,
        pinnedMemory === null ? 'app.projectMemoryCleared' : 'app.projectMemorySaved',
      ),
    );
  };

  const updateSessionPinnedMemory = async (sessionId: string, pinnedMemory: string | null) => {
    const saved = await updateSessionModelConfig({ sessionId, patch: { pinnedMemory } });
    if (!saved) return;
    setNotice(
      translate(
        localeRef.current,
        pinnedMemory === null ? 'app.sessionMemoryCleared' : 'app.sessionMemorySaved',
      ),
    );
  };

  const pinSessionNote = async (sessionId: string, note: string) => {
    const trimmed = note.trim();
    if (trimmed === '') return;
    const session = Object.values(latest.current.sessions)
      .flat()
      .find((item) => item.id === sessionId);
    if (!session) return;
    const existing = session.pinnedMemory?.trim() ?? '';
    const next = existing === '' ? trimmed : `${existing}\n${trimmed}`;
    if (next.length > MAX_PINNED_MEMORY_CHARS) {
      warn(
        translate(localeRef.current, 'app.pinnedMemoryTooLong', {
          max: MAX_PINNED_MEMORY_CHARS,
        }),
      );
      return;
    }
    const saved = await updateSessionModelConfig({ sessionId, patch: { pinnedMemory: next } });
    if (saved) setNotice(translate(localeRef.current, 'app.pinnedMemorySaved'));
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
      sourceAccountId?: string | null;
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
      sourceAccountId?: string | null;
      approvedIds: string[];
      rulesStrategy: RulesStrategy;
    }): Promise<ProfileSyncApplyResult | null> => {
      const result = await call(() => window.inova.applyProfileSync(input));
      return result?.value ?? null;
    },
    [call],
  );

  const ensureSessionLoaded = useCallback(
    (sessionId: string) => {
      if (!latest.current.chats[sessionId]) void loadChat(sessionId);
    },
    [loadChat],
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
  const paneIds = visibleSessionIds(tabs);

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
  const runningCount = Object.values(chats).filter((chat) => chat.running).length;
  const projectSettingsTarget = projects.find((item) => item.id === projectSettingsId);
  const activeAccount = effectiveAccountOf(activeSession, activeProject);
  const chatTabs = tabs.tabs.filter((tab) => tab.kind === 'chat');
  const activeAccountLabel = activeAccount?.label ?? activeProject?.accountLabel ?? null;

  useEffect(() => {
    if (activeAccountLabel && !modelsByAccount[activeAccountLabel]) {
      void loadModels(activeAccountLabel);
    }
  }, [activeAccountLabel, modelsByAccount, loadModels]);

  const runShortcut = ({ id, tabIndex }: ShortcutCommand): boolean => {
    switch (id) {
      case 'open-settings':
        if (settingsOpen) {
          setSettingsOpen(false);
          return true;
        }
        if (settings === null) return false;
        setSettingsOpen(true);
        return true;
      case 'open-command-palette':
        if (settingsOpen) return false;
        setCommandPaletteOpen((current) => !current);
        return true;
      case 'new-session':
        setView('new-session');
        return true;
      case 'open-inbox':
        if (inboxRef.current === null) return false;
        inboxRef.current.focus();
        return true;
      case 'close-tab':
        if (!inWorkspace || !activeTab) return false;
        requestCloseTab(activeTab);
        return true;
      case 'select-tab': {
        const target = tabIndex === null ? undefined : chatTabs[tabIndex];
        if (!target) return false;
        activateTab(target.sessionId);
        return true;
      }
      case 'prev-tab':
      case 'next-tab': {
        const sessionId = adjacentSessionId({ state: tabs, delta: id === 'next-tab' ? 1 : -1 });
        if (sessionId === null) return false;
        activateTab(sessionId);
        return true;
      }
      case 'archive-session':
        if (!inWorkspace || !activeSession || activeSession.archivedAt !== null) return false;
        setPendingArchive(activeSession);
        return true;
      case 'focus-composer':
        return inWorkspace && (activeChatRef.current?.focusComposer() ?? false);
      case 'toggle-dictation':
        return inWorkspace && (activeChatRef.current?.toggleDictation() ?? false);
      case 'send-message':
      case 'submit-new-session':
      case 'dismiss':
        return false;
    }
  };

  useGlobalShortcuts({ isMac: IS_MAC, settingsOpen, commandPaletteOpen, run: runShortcut });

  const activeProvider = activeAccount?.provider ?? activeTab?.provider ?? null;
  const activeCatalog = activeProvider
    ? ((activeAccountLabel ? modelsByAccount[activeAccountLabel] : undefined) ??
      PROVIDER_MODELS[activeProvider])
    : null;
  const activeModelConfig =
    activeSession && activeProvider && settings
      ? resolveModelConfig({
          provider: activeProvider,
          model: activeSession.model ?? null,
          effort: activeSession.effort ?? null,
          settings,
        })
      : { model: activeSession?.model ?? null, effort: activeSession?.effort ?? null };
  const activeMode =
    activeSession && activeProvider
      ? resolveExecutionMode({
          provider: activeProvider,
          sessionMode: activeSession.mode,
          defaultModes,
        })
      : null;

  const commandPaletteItems: CommandPaletteItem[] = commandPaletteOpen
    ? (() => {
        const projectMap = new Map(projects.map((project) => [project.id, project] as const));
        return buildCommandPaletteItems({
          locale,
          actions: [
            {
              id: 'action:new-session',
              title: t('app.palette.newSessionTitle'),
              subtitle: t('app.palette.newSessionSub'),
              shortcutId: 'new-session',
              keywords: ['criar', 'chat', 'new'],
            },
            {
              id: 'action:toggle-sidebar',
              title: sidebarCollapsed
                ? t('app.palette.toggleSidebarOpen')
                : t('app.palette.toggleSidebarClose'),
              keywords: ['sidebar', 'painel'],
            },
            ...(activeSession
              ? [
                  {
                    id: 'action:toggle-inspector',
                    title: detailsCollapsed
                      ? t('app.palette.toggleDetailsOpen')
                      : t('app.palette.toggleDetailsClose'),
                    keywords: ['inspector', 'contexto', 'detalhes'],
                  },
                  {
                    id: 'action:open-git-diff',
                    title: t('app.palette.inspectDiffTitle'),
                    keywords: ['git', 'diff', 'alteracoes'],
                  },
                  {
                    id: 'action:run-verification',
                    title: t('app.palette.runVerifyTitle'),
                    keywords: ['check', 'testes', 'lint'],
                  },
                ]
              : []),
            {
              id: 'action:view-workspace',
              title: t('app.palette.goToWorkspace'),
              keywords: ['chat', 'conversa'],
            },
            {
              id: 'action:view-agents',
              title: t('app.palette.goToAgents'),
              keywords: ['agentes', 'execucao'],
            },
            {
              id: 'action:view-compare',
              title: t('app.palette.goToCompare'),
              keywords: ['compare', 'diff'],
            },
            {
              id: 'action:view-accounts',
              title: t('app.palette.goToAccounts'),
              keywords: ['contas', 'uso'],
            },
            ...(settings !== null
              ? [
                  {
                    id: 'action:open-settings',
                    title: t('app.palette.settingsTitle'),
                    shortcutId: 'open-settings' as const,
                    keywords: ['settings', 'preferencias'],
                  },
                ]
              : []),
          ],
          sessions: Object.values(sessions)
            .flat()
            .map((session) => {
              const project = projectMap.get(session.projectId);
              const account = effectiveAccountOf(session, project);
              const provider = account?.provider ?? 'claude';
              return {
                id: session.id,
                title: session.title,
                projectName: project ? folderName(project.path) : t('app.palette.projectFallback'),
                providerLabel: PROVIDER_NAME[provider],
                branch: session.worktree?.branch ?? null,
                active: activeSession?.id === session.id && inWorkspace,
                archived: session.archivedAt !== null,
              };
            }),
          projects: projects.map((project) => ({
            id: project.id,
            name: folderName(project.path),
            path: project.path,
            accountLabel: project.accountLabel,
          })),
          models:
            activeSession && activeCatalog
              ? activeCatalog.models.map((model) => ({
                  id: model.id,
                  label: localizeModelOption(model, locale).label,
                  active: activeModelConfig.model === model.id,
                }))
              : [],
          modes:
            activeSession && activeProvider && activeMode
              ? PROVIDER_MODES[activeProvider].options.map((option) => ({
                  id: option.id,
                  label: modeOptionText(activeProvider, option, locale).label,
                  active: activeMode === option.id,
                }))
              : [],
        });
      })()
    : [];

  const handleCommandPaletteSelect = (item: CommandPaletteItem) => {
    setCommandPaletteOpen(false);
    switch (item.category) {
      case 'Sessões': {
        const target = sessionById.get(item.id.slice('session:'.length));
        if (target) void openChatTab(target);
        return;
      }
      case 'Projetos': {
        const target = projects.find((project) => project.id === item.id.slice('project:'.length));
        if (target) void newSession({ project: target, parent: null });
        return;
      }
      case 'Modelos': {
        if (!activeSession) return;
        const modelId = item.id.slice('model:'.length);
        void updateSessionModelConfig({ sessionId: activeSession.id, patch: { model: modelId } });
        return;
      }
      case 'Modos': {
        if (!activeSession || !activeProvider) return;
        const modeId = item.id.slice('mode:'.length);
        const matched = PROVIDER_MODES[activeProvider].options.find((opt) => opt.id === modeId);
        if (matched) {
          void updateSessionModelConfig({
            sessionId: activeSession.id,
            patch: { mode: matched.id },
          });
        }
        return;
      }
      case 'Ações':
        switch (item.id) {
          case 'action:new-session':
            setView('new-session');
            return;
          case 'action:toggle-sidebar':
            void updateSettings({ appearance: { sidebarCollapsed: !sidebarCollapsed } });
            return;
          case 'action:toggle-inspector':
            void updateSettings({ appearance: { detailsCollapsed: !detailsCollapsed } });
            return;
          case 'action:open-git-diff':
            if (activeSession) void inspectWorktree(activeSession);
            return;
          case 'action:run-verification':
            if (activeSession) void runVerification(activeSession.id);
            return;
          case 'action:view-workspace':
            setView('workspace');
            return;
          case 'action:view-agents':
            setView('agents');
            return;
          case 'action:view-compare':
            setView('compare');
            return;
          case 'action:view-accounts':
            setView('accounts');
            return;
          case 'action:open-settings':
            if (settings !== null) setSettingsOpen(true);
            return;
        }
    }
  };

  return (
    <I18nProvider locale={locale}>
      <div className="app">
        <TooltipLayer isMac={IS_MAC} />
        {warning && (
          <button type="button" className="warning" role="alert" onClick={dismiss}>
            <span className="warning-icon" aria-hidden="true">
              <AlertIcon size={16} />
            </span>
            <span>{warning}</span>
          </button>
        )}
        {notice && !warning && (
          <button type="button" className="warning" role="status" onClick={() => setNotice(null)}>
            <span>{notice}</span>
          </button>
        )}
        <Header
          runningCount={runningCount}
          update={
            updates.updateAvailable && updates.info?.latest
              ? {
                  latest: updates.info.latest,
                  installing: updates.installing,
                  onInstall: () => {
                    if (runningCount > 0) setConfirmUpdateRestart(true);
                    else void updates.install();
                  },
                }
              : null
          }
          onOpenCommandPalette={() => runShortcut({ id: 'open-command-palette', tabIndex: null })}
          onOpenSettings={() => runShortcut({ id: 'open-settings', tabIndex: null })}
          tabs={chatTabs}
          activeTabId={tabs.active}
          inWorkspace={inWorkspace}
          statusOf={(sessionId) => sessionStatus(chats[sessionId])}
          queuedCountOf={(sessionId) =>
            turnQueue.filter((item) => item.sessionId === sessionId).length
          }
          onActivateTab={activateTab}
          onCloseTab={requestCloseTab}
          paneIds={paneIds}
          onSplitTab={splitTab}
          onMoveTab={({ sessionId, toIndex }) => dispatch({ type: 'move', sessionId, toIndex })}
        />
        <div className="app-body">
          <Sidebar
            view={view}
            inboxRef={inboxRef}
            onNavigate={setView}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() =>
              void updateSettings({ appearance: { sidebarCollapsed: !sidebarCollapsed } })
            }
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
            onOpenProjectSettings={(project) => setProjectSettingsId(project.id)}
            onImportSessions={(project) => setImportProject(project)}
            onUnbind={async (project) => {
              const result = await call(() => window.inova.unbindProject({ path: project.path }));
              if (!result) return;
              dropSessions(sessionIdsOf([project.id]));
              await reloadProjects();
            }}
            onRenameSession={(input) => void renameSession(input)}
            onDeleteSession={(session) => void deleteSession(session)}
            onRequestArchiveSession={setPendingArchive}
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
                onOpen={activateTab}
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
                modelDefaults={settings?.models ?? null}
                selectedGroupId={selectedComparisonGroupId}
                onSelectGroup={setSelectedComparisonGroupId}
                onStartComparison={startComparison}
                onGetDiff={getComparisonDiff}
                onResolveComparison={resolveComparison}
                onOpenSession={(session) => void openChatTab(session)}
                onEnsureSessionLoaded={ensureSessionLoaded}
                onWarn={warn}
              />
            )}
            {view === 'accounts' && (
              <AccountsView
                accounts={accounts}
                projects={projects}
                usage={usage}
                call={call}
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
                    applyingWorktree ||
                    (activeTab.kind === 'chat'
                      ? Boolean(chats[activeTab.sessionId]?.running)
                      : false)
                  }
                  status={
                    activeTab.kind === 'chat' ? sessionStatus(chats[activeTab.sessionId]) : null
                  }
                  exited={activeTab.exited}
                  detailsCollapsed={detailsCollapsed}
                  onToggleDetails={() =>
                    void updateSettings({ appearance: { detailsCollapsed: !detailsCollapsed } })
                  }
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
                  onClose={() => requestCloseTab(activeTab)}
                />
              ) : (
                <p className="hint">{t('app.emptySessionHint')}</p>
              )}
              <div className="session-stage">
                <div className="session-panes">
                  {tabs.tabs.map((tab) => {
                    const tabSession = sessionById.get(tab.sessionId);
                    const tabProject = projectOf(tab.sessionId);
                    const tabAccount = effectiveAccountOf(tabSession, tabProject);
                    const tabProvider = tabAccount?.provider ?? tab.provider;
                    const tabAccountLabel = tabAccount?.label ?? tabProject?.accountLabel;
                    const tabCatalog =
                      (tabAccountLabel ? modelsByAccount[tabAccountLabel] : undefined) ??
                      PROVIDER_MODELS[tabProvider ?? 'claude'];
                    const tabModelConfig = settings
                      ? resolveModelConfig({
                          provider: tabProvider ?? 'claude',
                          model: tabSession?.model ?? null,
                          effort: tabSession?.effort ?? null,
                          settings,
                        })
                      : { model: tabSession?.model ?? null, effort: tabSession?.effort ?? null };
                    const tabState = chats[tab.sessionId] ?? initialChatState;
                    const tabQueuedTurns = turnQueue.filter(
                      (item) => item.sessionId === tab.sessionId,
                    );
                    const tabWaitingForAccount =
                      tabQueuedTurns.length > 0 &&
                      isAccountBusyElsewhere({
                        sessionId: tab.sessionId,
                        accountId: tabAccount?.id,
                        runningAccounts: new Map(
                          Object.entries(chats)
                            .filter(([, chat]) => chat.running)
                            .map(([sessionId]) => [
                              sessionId,
                              effectiveAccountOf(sessionById.get(sessionId), projectOf(sessionId))
                                ?.id,
                            ]),
                        ),
                      });
                    const alternativeAccounts = accounts.filter(
                      (candidate) => candidate.id !== tabAccount?.id,
                    );
                    const tabFailoverNotice = failoverNotices[tab.sessionId] ?? null;
                    const tabFailoverFromId = tabFailoverNotice?.fromAccountId ?? null;
                    const paneIndex = paneIds.indexOf(tab.sessionId);
                    const focusedPane = tabs.split !== null && tab.sessionId === tabs.active;
                    const focusPaneHandler =
                      tabs.split !== null && !focusedPane
                        ? () => activateTab(tab.sessionId)
                        : undefined;
                    return (
                      <div
                        key={tab.sessionId}
                        className={`session-pane${focusedPane ? ' session-pane-focused' : ''}${paneIndex === 1 ? ' session-pane-second' : ''}`}
                        style={paneIndex === -1 ? { display: 'none' } : { order: paneIndex }}
                        onMouseDownCapture={focusPaneHandler}
                        onFocusCapture={focusPaneHandler}
                      >
                        {tabs.split !== null && (
                          <div className="session-pane-bar">
                            <ProviderBadge provider={tabProvider} size={16} />
                            <span className="session-pane-title">{tab.title}</span>
                            <button
                              type="button"
                              className="icon-btn session-pane-close"
                              aria-label={t('tabs.closePane', { title: tab.title })}
                              data-tooltip={t('tabs.closePane', { title: tab.title })}
                              onClick={() =>
                                dispatch({ type: 'unsplit', sessionId: tab.sessionId })
                              }
                            >
                              <CloseIcon size={12} />
                            </button>
                          </div>
                        )}
                        <ChatView
                          ref={tab.sessionId === tabs.active ? activeChatRef : undefined}
                          sessionId={tab.sessionId}
                          projectId={tabProject?.id ?? null}
                          state={tabState}
                          visible={inWorkspace && paneIndex !== -1}
                          provider={tabProvider}
                          accountDisplay={accountDisplayOf(tabAccount, tabProject)}
                          model={tabModelConfig.model}
                          effort={tabModelConfig.effort}
                          mode={tabSession?.mode ?? null}
                          defaultModes={defaultModes}
                          inWorktree={Boolean(tabSession?.worktree)}
                          workingDir={tabSession?.worktree?.path ?? tabProject?.path ?? null}
                          voiceHints={collectVoiceHints({
                            projectName: tabProject ? folderName(tabProject.path) : null,
                            branch: tabSession?.worktree?.branch ?? null,
                            customDictionary: settings?.voice.customDictionary,
                            recentToolInputs: tabState.items
                              .filter((item) => item.type === 'tool')
                              .slice(-12)
                              .map((item) => item.input),
                            pinnedMemory: [tabProject?.pinnedMemory, tabSession?.pinnedMemory]
                              .filter((value): value is string => Boolean(value))
                              .join('\n'),
                          })}
                          dictationLanguage={settings?.voice.language}
                          dictationPolishMode={settings?.voice.polishMode}
                          collapseFinishedTurns={settings?.sessions.collapseFinishedTurns}
                          catalog={tabCatalog}
                          readOnly={archivedIds.has(tab.sessionId)}
                          queuedTurns={tabQueuedTurns}
                          queuePaused={pausedQueueIds.includes(tab.sessionId)}
                          queueWaitingForAccount={tabWaitingForAccount}
                          busyConflict={busyConflicts[tab.sessionId] ?? null}
                          failoverNotice={tabFailoverNotice}
                          alternativeAccounts={alternativeAccounts}
                          onChangeModelConfig={(patch) =>
                            void updateSessionModelConfig({ sessionId: tab.sessionId, patch })
                          }
                          onChangeMode={(mode) =>
                            void updateSessionModelConfig({
                              sessionId: tab.sessionId,
                              patch: { mode },
                            })
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
                          onRewindTurn={(turnIndex) =>
                            setPendingRewind({ sessionId: tab.sessionId, turnIndex })
                          }
                          onRegenerate={(extraDirs) =>
                            setPendingRewind({
                              sessionId: tab.sessionId,
                              turnIndex:
                                tabState.items.filter((item) => item.type === 'user').length - 1,
                              resend: { extraDirs },
                            })
                          }
                          composerSeed={pendingComposerText[tab.sessionId] ?? null}
                          onComposerSeedApplied={() =>
                            setPendingComposerText((current) =>
                              Object.fromEntries(
                                Object.entries(current).filter(([id]) => id !== tab.sessionId),
                              ),
                            )
                          }
                          onSendToParent={
                            tabSession &&
                            tabSession.parentId !== null &&
                            (sessions[tabSession.projectId] ?? []).some(
                              (item) => item.id === tabSession.parentId && item.archivedAt === null,
                            )
                              ? (findings) => void sendFindingsToParent(tabSession, findings)
                              : undefined
                          }
                          onClearSession={() => void clearConversation(tab.sessionId)}
                          onClearAndContinue={() => void clearAndContinue(tab.sessionId)}
                          onCompactAndContinue={
                            tabProvider &&
                            nativeSlashCommands(tabProvider).some(
                              (command) => command.name === 'compact',
                            )
                              ? () => void compactAndContinue(tab.sessionId)
                              : undefined
                          }
                          onFeedback={({ turnIndex, value }) =>
                            void recordFeedback({ sessionId: tab.sessionId, turnIndex, value })
                          }
                          onWarn={warn}
                          onOpenHandoff={
                            tabSession ? () => setPendingHandoff(tabSession) : undefined
                          }
                          onEnqueuePrompt={(input) =>
                            void enqueuePrompt({
                              sessionId: tab.sessionId,
                              extraDirs: busyConflicts[tab.sessionId]?.extraDirs,
                              ...input,
                            })
                          }
                          onResumeQueue={() => void resumeQueue(tab.sessionId)}
                          onCancelQueuedTurn={(turnId) => void cancelQueuedTurn(turnId)}
                          onSwitchAccountAndRetry={({ accountId, prompt }) =>
                            void switchAccountAndRetry({
                              sessionId: tab.sessionId,
                              accountId,
                              prompt,
                            })
                          }
                          onDismissBusyConflict={() => clearBusyConflict(tab.sessionId)}
                          onAcceptFailover={() => clearFailoverNotice(tab.sessionId)}
                          onRevertFailover={
                            tabFailoverFromId
                              ? () => void revertFailoverAccount(tab.sessionId, tabFailoverFromId)
                              : undefined
                          }
                          onPinNote={(note) => void pinSessionNote(tab.sessionId, note)}
                          onSend={(prompt, extraDirs) =>
                            void sendMessage(tab.sessionId, prompt, extraDirs)
                          }
                          onCancel={() => window.inova.cancelTurn(tab.sessionId)}
                        />
                      </div>
                    );
                  })}
                </div>
                {activeSession && activeProject && (
                  <SessionDetails
                    sessionId={activeSession.id}
                    subagents={chats[activeSession.id]?.subagents}
                    context={chats[activeSession.id]?.context}
                    sessionUsage={activeSession.usageTotals ?? null}
                    projectUsage={sumSessionUsageTotals(
                      (sessions[activeProject.id] ?? []).map((item) => item.usageTotals),
                    )}
                    projectSessionCount={(sessions[activeProject.id] ?? []).length}
                    turnUsages={turnUsagesBySession[activeSession.id]}
                    collapsed={detailsCollapsed}
                    kind={activeSession.parentId ? 'subsession' : 'session'}
                    sectionName={folderName(activeProject.path)}
                    parentTitle={activeParentTitle}
                    provider={activeAccount?.provider ?? activeTab?.provider ?? null}
                    accountDisplay={accountDisplayOf(activeAccount, activeProject)}
                    path={activeProject.path}
                    worktreeBranch={activeSession.worktree?.branch ?? null}
                    worktreeBusy={
                      applyingWorktree ||
                      revertingFiles ||
                      Boolean(chats[activeSession.id]?.running)
                    }
                    running={Boolean(chats[activeSession.id]?.running)}
                    gitRevision={gitRevision}
                    onInspectWorktree={(filePath) => void inspectWorktree(activeSession, filePath)}
                    onApplyWorktree={
                      activeSession.worktree ? () => void applyWorktree(activeSession) : undefined
                    }
                    onRevertFiles={(files) => {
                      if (files.length > 0) setPendingRevert({ session: activeSession, files });
                    }}
                    onReviewDiff={() => void reviewSessionDiff(activeSession)}
                    reviewBusy={reviewingDiff}
                    onHandoff={() => setPendingHandoff(activeSession)}
                    projectPinnedMemory={activeProject.pinnedMemory ?? null}
                    sessionPinnedMemory={activeSession.pinnedMemory ?? null}
                    pinnedMemoryDisabled={archivedIds.has(activeSession.id)}
                    onSaveProjectPinnedMemory={(value) =>
                      updateProjectPinnedMemory(activeProject.id, value)
                    }
                    onSaveSessionPinnedMemory={(value) =>
                      updateSessionPinnedMemory(activeSession.id, value)
                    }
                  />
                )}
              </div>
            </div>
          </main>
        </div>
        <Footer
          accounts={accounts}
          focusedAccountLabel={inWorkspace ? activeAccountLabel : null}
          usage={usage}
          warningHistory={warningHistory}
          onClearWarningHistory={clearWarningHistory}
          onLoadUsage={(account) => void loadUsage(account.label)}
          onManageAccounts={() => setView('accounts')}
          version={updates.version}
          updateAvailable={updates.updateAvailable}
          onOpenChangelog={updates.openChangelog}
        />
        {updates.installing ? (
          <UpdateProgress latest={updates.info?.latest ?? null} stage={updates.installStage} />
        ) : (
          updates.toastVisible &&
          updates.info && <UpdateToast info={updates.info} onDismiss={updates.dismissToast} />
        )}
        {updates.changelog && (
          <ChangelogModal
            version={updates.version}
            whatsNew={updates.changelog.whatsNew}
            onClose={updates.closeChangelog}
          />
        )}
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
        {confirmUpdateRestart && (
          <ConfirmModal
            title={t('app.confirmRestartTitle')}
            description={
              runningCount === 1
                ? t('app.confirmRestartDescSingular')
                : t('app.confirmRestartDescPlural', { count: runningCount })
            }
            confirmLabel={t('app.confirmRestartBtn')}
            onCancel={() => setConfirmUpdateRestart(false)}
            onConfirm={() => {
              setConfirmUpdateRestart(false);
              void updates.install();
            }}
          />
        )}
        {pendingRemoveAccount && (
          <ConfirmModal
            title={t('app.confirmRemoveAccountTitle')}
            description={t('app.confirmRemoveAccountDesc', {
              account: accountDisplayName(pendingRemoveAccount),
            })}
            confirmLabel={t('app.confirmRemoveAccountBtn')}
            danger
            onCancel={() => setPendingRemoveAccount(null)}
            onConfirm={() => {
              const target = pendingRemoveAccount;
              setPendingRemoveAccount(null);
              void confirmRemoveAccount(target);
            }}
          />
        )}
        {pendingRewind && (
          <ConfirmModal
            title={
              pendingRewind.resend
                ? t('app.confirmRewindRegenTitle')
                : t('app.confirmRewindBackTitle')
            }
            description={t('app.confirmRewindDesc')}
            confirmLabel={
              pendingRewind.resend ? t('app.confirmRewindRegenBtn') : t('app.confirmRewindBackBtn')
            }
            danger
            onCancel={() => setPendingRewind(null)}
            onConfirm={() => {
              const target = pendingRewind;
              setPendingRewind(null);
              if (target.resend) {
                void regenerateLastTurn({
                  sessionId: target.sessionId,
                  extraDirs: target.resend.extraDirs,
                });
              } else {
                void confirmRewindTurn({
                  sessionId: target.sessionId,
                  turnIndex: target.turnIndex,
                });
              }
            }}
          />
        )}
        {pendingCloseTab && (
          <ConfirmModal
            title={t('app.confirmCloseTabTitle')}
            description={t('app.confirmCloseTabDesc', { title: pendingCloseTab.title })}
            confirmLabel={t('app.confirmCloseTabBtn')}
            danger
            onCancel={() => setPendingCloseTab(null)}
            onConfirm={() => {
              const target = pendingCloseTab;
              setPendingCloseTab(null);
              closeTab(target);
            }}
          />
        )}
        {pendingArchive && (
          <ConfirmModal
            title={
              pendingArchive.parentId !== null
                ? t('app.confirmArchiveSubTitle')
                : t('app.confirmArchiveSessionTitle')
            }
            description={
              pendingArchive.parentId !== null
                ? t('app.confirmArchiveSubDesc', { title: pendingArchive.title })
                : t('app.confirmArchiveSessionDesc', { title: pendingArchive.title })
            }
            confirmLabel={
              pendingArchive.parentId !== null
                ? t('app.confirmArchiveSubBtn')
                : t('app.confirmArchiveSessionBtn')
            }
            danger
            onCancel={() => setPendingArchive(null)}
            onConfirm={() => {
              const target = pendingArchive;
              setPendingArchive(null);
              void setArchived({ session: target, archived: true });
            }}
          />
        )}
        {pendingRestore && (
          <ConfirmModal
            title={t('app.confirmRestoreTitle')}
            description={
              pendingRestore.skippedLargeFiles.length > 0
                ? t('app.confirmRestoreLargeDesc', {
                    files: pendingRestore.skippedLargeFiles.join(', '),
                  })
                : t('app.confirmRestoreDefaultDesc')
            }
            confirmLabel={t('app.confirmRestoreBtn')}
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
            title={t('app.confirmForceDeleteTitle')}
            description={t('app.confirmForceDeleteDesc', { title: pendingForceDelete.title })}
            confirmLabel={t('app.confirmForceDeleteBtn')}
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
          <SessionDiffModal
            key={worktreeModal.session.id}
            status={worktreeModal.status}
            hasWorktree={Boolean(worktreeModal.session.worktree)}
            busy={
              applyingWorktree ||
              revertingFiles ||
              reviewingDiff ||
              Boolean(chats[worktreeModal.session.id]?.running)
            }
            initialFilePath={worktreeModal.initialFilePath}
            onClose={() => setWorktreeModal(null)}
            onRefresh={() => void inspectWorktree(worktreeModal.session)}
            onApplyWorktree={
              worktreeModal.session.worktree
                ? () => void applyWorktree(worktreeModal.session)
                : undefined
            }
            onReviewDiff={() => void reviewSessionDiff(worktreeModal.session)}
            onRevertFiles={(files) => {
              if (files.length > 0) setPendingRevert({ session: worktreeModal.session, files });
            }}
          />
        )}
        {pendingRevert && (
          <ConfirmModal
            title={
              pendingRevert.files.length === 1
                ? t('app.confirmRevertSingleTitle')
                : t('app.confirmRevertAllTitle')
            }
            description={
              pendingRevert.files.length === 1
                ? t('app.confirmRevertSingleDesc', { file: pendingRevert.files[0] ?? '' })
                : t('app.confirmRevertAllDesc', { count: pendingRevert.files.length })
            }
            confirmLabel={
              pendingRevert.files.length === 1
                ? t('app.confirmRevertSingleBtn')
                : t('app.confirmRevertAllBtn')
            }
            danger
            onCancel={() => setPendingRevert(null)}
            onConfirm={() => {
              const target = pendingRevert;
              setPendingRevert(null);
              void revertSessionFiles(target.session, target.files);
            }}
          />
        )}
        {pendingFork && (
          <ForkModal
            session={pendingFork.session}
            turnIndex={pendingFork.turnIndex}
            isLatestTurn={pendingFork.isLatestTurn}
            sourceAccount={effectiveAccountOf(
              pendingFork.session,
              projectOf(pendingFork.session.id),
            )}
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
        {projectSettingsTarget && (
          <ProjectSettingsModal
            project={projectSettingsTarget}
            running={Boolean(activeSession && chats[activeSession.id]?.running)}
            canRunVerification={activeSession?.projectId === projectSettingsTarget.id}
            onUpdate={(patch) => void updateProjectVerification(projectSettingsTarget.id, patch)}
            onDetectChecks={() => void detectChecks(projectSettingsTarget)}
            onRunVerification={() => {
              if (activeSession) void runVerification(activeSession.id);
            }}
            onClose={() => setProjectSettingsId(null)}
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
        {importProject && (
          <ImportSessionModal
            project={importProject}
            accounts={accounts}
            onList={listExternalSessions}
            onImport={(requests) => importSessions({ project: importProject, requests })}
            onClose={() => setImportProject(null)}
          />
        )}
        {commandPaletteOpen && (
          <CommandPaletteModal
            items={commandPaletteItems}
            isMac={IS_MAC}
            onSelect={handleCommandPaletteSelect}
            onClose={() => setCommandPaletteOpen(false)}
          />
        )}
        {settingsOpen && settings && (
          <SettingsModal
            settings={settings}
            defaultModes={defaultModes}
            isMac={IS_MAC}
            call={call}
            onUpdate={(patch) => void updateSettings(patch)}
            onSetDefaultMode={(provider, mode) => void setDefaultProviderMode(provider, mode)}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
    </I18nProvider>
  );
}
