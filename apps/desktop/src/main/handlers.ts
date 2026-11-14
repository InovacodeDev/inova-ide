import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { addAccount, findAccount, removeAccount } from '@inova/core/accounts';
import type { ChatEvent, UsageSnapshot } from '@inova/core/chat-types';
import { expandCommandPrompt, splitLeadingSlash } from '@inova/core/command-prompt';
import { listProjectCommands } from '@inova/core/commands';
import { listProjectFiles, rankProjectFiles, type ProjectFileList } from '@inova/core/files';
import {
  checkpointExists,
  createCheckpoint,
  removeSessionCheckpoints,
  restoreCheckpoint,
} from '@inova/core/git-checkpoints';
import {
  applyComparisonWinner,
  createComparisonWorktrees,
  getComparisonDiff,
} from '@inova/core/git-compare';
import { tryRunGit } from '@inova/core/git-exec';
import {
  WorktreeError,
  applyWorktreeToProject,
  createSessionWorktree,
  getWorktreeStatus,
  removeSessionWorktree,
} from '@inova/core/git-worktree';
import {
  buildHandoffContext,
  isRateLimitMessage,
  sliceTranscriptToTurn,
  truncateTranscriptAtTurn,
} from '@inova/core/handoff';
import { buildChatTurn, buildLaunch, buildLogin } from '@inova/core/launch';
import type { ChatTurn, LaunchSpec } from '@inova/core/launch';
import {
  PROVIDER_MODELS,
  isEffortSupported,
  resolveModelConfig,
  parseAgyModelsOutput,
  parseOpenCodeModelsOutput,
} from '@inova/core/models';
import type { ProviderModels } from '@inova/core/models';
import { isModeSupported, resolveExecutionMode } from '@inova/core/modes';
import { applyProfileSync, previewProfileSync } from '@inova/core/profile-sync';
import {
  PathNotFoundError,
  bindProject,
  realPathOf,
  unbindProject,
  updateProjectConfig,
} from '@inova/core/projects';
import { providers, readAccountEmail } from '@inova/core/providers';
import type { CommandRunner } from '@inova/core/providers';
import {
  IMPORT_PROVIDERS,
  defaultCliHome,
  importExternalSession,
  listExternalSessions,
} from '@inova/core/session-import';
import {
  SessionError,
  createSession,
  deleteSession,
  descendantIds,
  effectiveCwd,
  getDefaultModes,
  getWorkspace,
  resolveSessionAccount,
  saveWorkspace,
  sessionsToAutoArchive,
  setDefaultProviderMode,
  updateSession,
} from '@inova/core/sessions';
import { getSettings, updateSettings } from '@inova/core/settings';
import { loadStore } from '@inova/core/store';
import type {
  Account,
  ExecutionMode,
  InboxAttentionKind,
  InboxItem,
  Project,
  ProviderId,
  QueuedTurn,
  Session,
  Settings,
  Store,
  VerificationCheck,
  Workspace,
} from '@inova/core/types';
import { UsageError, exhaustionResetAt, exhaustionVerdict, readUsage } from '@inova/core/usage';
import type { UsageDeps } from '@inova/core/usage';
import { detectProjectChecks, runVerificationChecks } from '@inova/core/verification';
import type {
  AccountView,
  AttachmentKind,
  ExternalSessionView,
  LoginEvent,
  PickedAttachment,
  ProjectView,
  Result,
  StartedLogin,
  UpdateInfo,
  WorktreeStatusView,
} from '../shared/api.js';
import { parseTranscriptLine } from './chat.js';
import type { ChatRunner } from './chat.js';
import { createLoginFlowManager } from './login-flow.js';
import type { SessionManager } from './sessions.js';
import { findBinary } from './shell-env.js';
import { createTurnQueue } from './turn-queue.js';
import { parseExternalUrl } from './updates-core.js';
import {
  fail,
  guarded,
  ok,
  parseApplyProfileSync,
  parseAttachmentPick,
  parseBinding,
  parseComparisonRef,
  parseDefaultMode,
  parseFileSearch,
  parseForkSession,
  parseHandoffSession,
  parseImportSessions,
  parseLoginCode,
  parseMessage,
  parseNewAccount,
  parseNewSession,
  parsePath,
  parsePreviewProfileSync,
  parseProjectRef,
  parseProjectVerification,
  parseRemoval,
  parseResolveComparison,
  parseRestoreCheckpoint,
  parseRecordFeedback,
  parseRewindSession,
  parseSessionDelete,
  parseSettingsPatch,
  parseSessionRef,
  parseSessionUpdate,
  parseStartComparison,
  parseSwitchAccount,
  parseTurnRef,
  parseUiFocus,
  parseUsageRequest,
  parseWorkspace,
  requireAccount,
  validated,
} from './validation.js';

export interface HandlerDeps {
  root: string;
  runner: CommandRunner;
  sessions: SessionManager;
  chat: ChatRunner;
  usageDeps: UsageDeps;
  emit: (sessionId: string, event: ChatEvent) => void;
  emitLogin?: (event: LoginEvent) => void;
  emitInbox?: (items: InboxItem[]) => void;
  emitQueue?: (queue: QueuedTurn[]) => void;
  notify?: (input: { title: string; body: string }) => Promise<Result<null>>;
  openNotificationSettings?: () => Promise<void>;
  openPath?: (path: string) => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
  updates?: { current: string; check: () => Promise<Result<UpdateInfo>> };
  baseEnv: () => Promise<NodeJS.ProcessEnv>;
  pickFolder: () => Promise<string | null>;
  pickAttachments: (kind: AttachmentKind) => Promise<PickedAttachment[]>;
}

const DEFAULT_TITLES: ReadonlySet<string> = new Set(['Nova sessão', 'Subsessão']);
const TITLE_CHARS = 60;
const FILE_CACHE_TTL_MS = 5_000;
const BUSY_MESSAGE = 'Já existe um turno em andamento nesta sessão.';
const ARCHIVED_MESSAGE = 'Desarquive a sessão antes de enviar mensagens.';
const NOTIFICATION_TOGGLES = {
  'waiting-input': 'waitingInput',
  failed: 'failed',
  completed: 'completed',
} as const satisfies Record<InboxAttentionKind, keyof Settings['notifications']>;

export function isExternalWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

async function projectView(project: Project, account: Account): Promise<ProjectView> {
  return {
    id: project.id,
    path: project.path,
    accountLabel: account.label,
    accountEmail: await readAccountEmail(account),
    provider: account.provider,
    autoWorktree: project.autoWorktree,
    autoVerify: project.autoVerify,
    verificationChecks: project.verificationChecks,
  };
}

function sessionsOf(store: Store): Session[] {
  return store.sessions ?? [];
}

function sessionIdsOfProjects(store: Store, projectIds: ReadonlySet<string>): string[] {
  return sessionsOf(store)
    .filter((session) => projectIds.has(session.projectId))
    .map((session) => session.id);
}

function importedProviderSessionIds(store: Store, projectId: string): Set<string> {
  return new Set(
    sessionsOf(store)
      .filter((session) => session.projectId === projectId)
      .flatMap((session) => session.providerSessionId ?? []),
  );
}

function formatLocalTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function titleFromPrompt(prompt: string): string {
  return (prompt.split('\n')[0] ?? prompt).slice(0, TITLE_CHARS).trim();
}

function requireSession(store: Store, sessionId: string): Session {
  const session = sessionsOf(store).find((item) => item.id === sessionId);
  if (!session) throw new SessionError('not-found', `Session not found: ${sessionId}`);
  return session;
}

function decideTurn(input: { session: Session; parent: Session | undefined; claude: boolean }): {
  turn: ChatTurn;
  newId: string | null;
} {
  const { session, parent, claude } = input;
  if (session.providerSessionId !== null) {
    return {
      turn: { mode: 'resume', providerSessionId: session.providerSessionId },
      newId: null,
    };
  }
  const sessionId = randomUUID();
  if (
    claude &&
    parent?.providerSessionId &&
    !session.handoffContext &&
    session.detachedFromParent !== true
  ) {
    return {
      turn: { mode: 'fork', parentProviderSessionId: parent.providerSessionId, sessionId },
      newId: sessionId,
    };
  }
  return { turn: { mode: 'new', sessionId }, newId: sessionId };
}

export function createHandlers(deps: HandlerDeps) {
  const transcriptDir = join(deps.root, 'sessions');
  const transcriptChains = new Map<string, Promise<void>>();
  const streamUsage = new Map<string, UsageSnapshot>();
  const modelsCache = new Map<string, ProviderModels>();
  const fileListCache = new Map<string, { list: ProjectFileList; expiresAt: number }>();
  const fileListInflight = new Map<string, Promise<ProjectFileList>>();
  const fileListGen = new Map<string, number>();
  const sessionProjects = new Map<string, string>();
  const turnOwners = new Map<string, { accountId: string; provider: ProviderId }>();
  const provisionalSessions = new Map<string, { providerSessionId: string; confirmed: boolean }>();
  const sessionTurnIds = new Map<string, string>();
  const cancelledTurns = new Set<string>();
  const verificationControllers = new Map<string, AbortController>();
  const turnQueue = createTurnQueue();
  const inboxMap = new Map<string, InboxItem>();
  const lastErrorBySession = new Map<string, string>();
  const exhaustedAccounts = new Map<string, string | null>();
  let uiFocus: { activeSessionId: string | null; windowFocused: boolean } = {
    activeSessionId: null,
    windowFocused: true,
  };
  let inboxChain: Promise<void> = Promise.resolve();
  let storeQueue: Promise<unknown> = Promise.resolve();

  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = storeQueue.then(() => work());
    storeQueue = run.catch(() => undefined);
    return run;
  }

  const transcriptPath = (sessionId: string): string => join(transcriptDir, `${sessionId}.jsonl`);

  function enqueueAppend(sessionId: string, event: ChatEvent): void {
    const previous = transcriptChains.get(sessionId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        await mkdir(transcriptDir, { recursive: true, mode: 0o700 });
        await appendFile(transcriptPath(sessionId), `${JSON.stringify(event)}\n`, { mode: 0o600 });
      })
      .catch((error: unknown) => {
        console.error(`inova: failed to append transcript of ${sessionId}`, error);
      });
    transcriptChains.set(sessionId, next);
    void next.then(() => {
      if (transcriptChains.get(sessionId) === next) transcriptChains.delete(sessionId);
    });
  }

  async function flushTranscript(sessionId: string): Promise<void> {
    await transcriptChains.get(sessionId);
  }

  async function readTranscriptEvents(sessionId: string): Promise<ChatEvent[]> {
    await flushTranscript(sessionId);
    let raw: string;
    try {
      raw = await readFile(transcriptPath(sessionId), 'utf8');
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
    return raw.split('\n').flatMap((line) => parseTranscriptLine(line) ?? []);
  }

  async function writeTranscriptEvents(
    sessionId: string,
    events: readonly ChatEvent[],
  ): Promise<void> {
    await flushTranscript(sessionId);
    await mkdir(transcriptDir, { recursive: true, mode: 0o700 });
    const body = events.map((event) => JSON.stringify(event)).join('\n');
    await writeFile(transcriptPath(sessionId), body === '' ? '' : `${body}\n`, { mode: 0o600 });
  }

  function sortedInbox(): InboxItem[] {
    return [...inboxMap.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  function emitInboxSnapshot(): void {
    deps.emitInbox?.(sortedInbox());
  }

  function emitQueueSnapshot(): void {
    deps.emitQueue?.(turnQueue.list());
  }

  function exhaustionEntry(accountId: string): { resetsAt: string | null } | null {
    const windows = streamUsage.get(accountId)?.windows ?? [];
    if (exhaustedAccounts.has(accountId)) {
      return { resetsAt: exhaustedAccounts.get(accountId) ?? exhaustionResetAt(windows) };
    }
    if (windows.some((window) => window.usedPercent >= 100)) {
      return { resetsAt: exhaustionResetAt(windows) };
    }
    return null;
  }

  function isFutureReset(resetsAt: string | null): boolean {
    return resetsAt !== null && Date.parse(resetsAt) > deps.usageDeps.now().getTime();
  }

  function isAccountExhausted(accountId: string): boolean {
    const entry = exhaustionEntry(accountId);
    if (entry === null) return false;
    return entry.resetsAt === null || isFutureReset(entry.resetsAt);
  }

  function exhaustedMessage(resetsAt: string | null): string {
    const time = resetsAt === null ? Number.NaN : Date.parse(resetsAt);
    const release = Number.isNaN(time) ? '' : ` Libera às ${formatLocalTime(new Date(time))}.`;
    return `CONTA_ESGOTADA: A conta atingiu o limite de uso.${release} Troque de conta ou execute handoff.`;
  }

  async function recheckExhaustion(input: {
    account: Account;
    resetsAt: string | null;
  }): Promise<string | null> {
    const { account, resetsAt } = input;
    let fresh: UsageSnapshot | null = null;
    try {
      fresh = await readUsage({ account, deps: deps.usageDeps });
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
    }
    const verdict = exhaustionVerdict({ resetsAt, now: deps.usageDeps.now(), fresh });
    const apiData = fresh !== null && fresh.source !== 'unavailable' ? fresh : null;
    if (verdict === 'available') {
      exhaustedAccounts.delete(account.id);
      if (apiData) streamUsage.set(account.id, apiData);
      else streamUsage.delete(account.id);
      return null;
    }
    const nextReset = apiData ? (exhaustionResetAt(apiData.windows) ?? resetsAt) : resetsAt;
    exhaustedAccounts.set(account.id, nextReset);
    if (apiData) streamUsage.set(account.id, apiData);
    return exhaustedMessage(nextReset);
  }

  async function gitSummaryFor(cwd: string): Promise<string | undefined> {
    const [status, stat] = await Promise.all([
      tryRunGit({ cwd, args: ['status', '--short'] }),
      tryRunGit({ cwd, args: ['diff', '--stat'] }),
    ]);
    const parts = [status.ok ? status.stdout.trim() : '', stat.ok ? stat.stdout.trim() : ''].filter(
      (part) => part !== '',
    );
    return parts.length > 0 ? parts.join('\n') : undefined;
  }

  function enqueueInboxUpdate(input: {
    sessionId: string;
    kind: InboxAttentionKind;
    summary: string;
  }): void {
    const work = inboxChain.then(async () => {
      const store = await loadStore(deps.root);
      const session = sessionsOf(store).find((item) => item.id === input.sessionId);
      const project = session
        ? store.projects.find((item) => item.id === session.projectId)
        : undefined;
      const account =
        session && project
          ? resolveSessionAccount({ session, project, accounts: store.accounts })
          : undefined;
      if (!session || !project || !account) return;
      inboxMap.set(session.id, {
        sessionId: session.id,
        projectId: project.id,
        sessionTitle: session.title,
        projectName: basename(project.path),
        provider: account.provider,
        kind: input.kind,
        summary: input.summary,
        at: deps.usageDeps.now().toISOString(),
        unread: true,
      });
      emitInboxSnapshot();
      const { notifications } = await getSettings(deps.root);
      if (
        notifications[NOTIFICATION_TOGGLES[input.kind]] &&
        (!notifications.onlyWhenUnfocused || !uiFocus.windowFocused)
      ) {
        await deps.notify?.({ title: session.title, body: input.summary });
      }
    });
    inboxChain = work.catch((error: unknown) => {
      console.error(`inova: failed to update inbox for ${input.sessionId}`, error);
    });
  }

  function removeSessionsRuntimeState(sessionIds: readonly string[]): void {
    const idSet = new Set(sessionIds);
    for (const id of sessionIds) {
      verificationControllers.get(id)?.abort();
      verificationControllers.delete(id);
      sessionTurnIds.delete(id);
      cancelledTurns.delete(id);
      lastErrorBySession.delete(id);
      sessionProjects.delete(id);
      turnQueue.cancelBySession(id);
    }
    emitQueueSnapshot();
    const deleteWork = inboxChain.then(() => {
      let changed = false;
      for (const id of idSet) {
        if (inboxMap.delete(id)) changed = true;
      }
      if (changed) emitInboxSnapshot();
    });
    inboxChain = deleteWork.catch((error: unknown) => {
      console.error('inova: failed to clear inbox items', error);
    });
  }

  async function drainAccountQueue(accountId: string): Promise<void> {
    if (deps.chat.accountsInUse().has(accountId) || isAccountExhausted(accountId)) return;
    const next = turnQueue.dequeueNext(accountId);
    if (!next) return;
    emitQueueSnapshot();
    const store = await loadStore(deps.root);
    const session = sessionsOf(store).find((item) => item.id === next.sessionId);
    const project = session
      ? store.projects.find((item) => item.id === session.projectId)
      : undefined;
    const account =
      session && project
        ? resolveSessionAccount({ session, project, accounts: store.accounts })
        : undefined;
    if (!session || !project || !account) return;
    const adapter = providers[account.provider];
    const baseEnv = await deps.baseEnv();
    const file = await findBinary(adapter.binary, baseEnv['PATH'] ?? '');
    if (file === undefined) {
      enqueueInboxUpdate({
        sessionId: session.id,
        kind: 'failed',
        summary: `${adapter.binary} não encontrado.`,
      });
      return;
    }
    await adapter.prepareLaunch(account.homeDir, baseEnv['HOME']);
    await serialized(async () => {
      if (deps.chat.isRunning(session.id) || deps.chat.accountsInUse().has(account.id)) {
        turnQueue.requeueFront(next);
        emitQueueSnapshot();
        return;
      }
      await runTurn({
        sessionId: session.id,
        prompt: next.prompt,
        account,
        project,
        file,
        baseEnv,
      });
    });
  }

  deps.chat.onAccountIdle?.((accountId) => {
    void drainAccountQueue(accountId).catch((error: unknown) => {
      console.error(`inova: failed to drain turn queue for ${accountId}`, error);
    });
  });

  async function removeTranscripts(sessionIds: readonly string[]): Promise<void> {
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        await flushTranscript(sessionId);
        await rm(transcriptPath(sessionId), { force: true });
      }),
    );
  }

  function adoptProviderSession(input: { sessionId: string; providerSessionId: string }): void {
    const { sessionId, providerSessionId } = input;
    void serialized(async () => {
      const session = requireSession(await loadStore(deps.root), sessionId);
      if (session.providerSessionId === null) {
        await updateSession({ root: deps.root, sessionId, patch: { providerSessionId } });
      }
    }).catch((error: unknown) => {
      console.error(`inova: failed to store provider session of ${sessionId}`, error);
    });
  }

  function discardProvisionalSession(input: {
    sessionId: string;
    providerSessionId: string;
  }): void {
    const { sessionId, providerSessionId } = input;
    void serialized(async () => {
      const session = requireSession(await loadStore(deps.root), sessionId);
      if (session.providerSessionId === providerSessionId) {
        await updateSession({ root: deps.root, sessionId, patch: { providerSessionId: null } });
      }
    }).catch((error: unknown) => {
      console.error(`inova: failed to clear provider session of ${sessionId}`, error);
    });
  }

  function trackProvisionalSession(sessionId: string, event: ChatEvent): void {
    const provisional = provisionalSessions.get(sessionId);
    if (!provisional) return;
    if (event.kind === 'session') provisional.confirmed = true;
    if (event.kind !== 'done') return;
    provisionalSessions.delete(sessionId);
    if (event.isError && !provisional.confirmed) {
      discardProvisionalSession({ sessionId, providerSessionId: provisional.providerSessionId });
    }
  }

  function invalidateProjectFiles(sessionId: string): void {
    const projectId = sessionProjects.get(sessionId);
    if (projectId !== undefined) {
      invalidateFilesByProjectId(projectId);
      return;
    }
    for (const key of new Set([...fileListCache.keys(), ...fileListInflight.keys()])) {
      fileListGen.set(key, (fileListGen.get(key) ?? 0) + 1);
    }
    fileListCache.clear();
  }

  function invalidateFilesByProjectId(projectId: string): void {
    const prefix = `${projectId}:`;
    fileListGen.set(projectId, (fileListGen.get(projectId) ?? 0) + 1);
    fileListCache.delete(projectId);
    for (const key of new Set([...fileListCache.keys(), ...fileListInflight.keys()])) {
      if (key.startsWith(prefix)) {
        fileListGen.set(key, (fileListGen.get(key) ?? 0) + 1);
        fileListCache.delete(key);
      }
    }
  }

  async function runVerificationForSession(input: {
    session: Session;
    project: Project;
    checks: VerificationCheck[];
    turnId: string;
  }): Promise<void> {
    const { session, project, checks, turnId } = input;
    const enabledChecks = checks.filter((check) => check.enabled);
    if (enabledChecks.length === 0) return;

    verificationControllers.get(session.id)?.abort();
    const controller = new AbortController();
    verificationControllers.set(session.id, controller);

    const cwd = effectiveCwd(session, project);
    const baseEnv = await deps.baseEnv();

    handleChatEvent(session.id, {
      kind: 'verification',
      turnId,
      status: 'running',
      checks: enabledChecks.map((check) => ({
        id: check.id,
        label: check.label,
        command: check.command,
        passed: false,
        timedOut: false,
        exitCode: null,
        output: '',
        durationMs: 0,
      })),
    });

    try {
      const result = await runVerificationChecks({
        cwd,
        checks: enabledChecks,
        env: baseEnv,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        handleChatEvent(session.id, {
          kind: 'verification',
          turnId,
          status: 'skipped',
          checks: result.checks,
        });
        return;
      }
      handleChatEvent(session.id, {
        kind: 'verification',
        turnId,
        status: result.status,
        checks: result.checks,
      });
    } finally {
      if (verificationControllers.get(session.id) === controller) {
        verificationControllers.delete(session.id);
      }
    }
  }

  async function maybeRunAutoVerification(sessionId: string): Promise<void> {
    const store = await loadStore(deps.root);
    const session = store.sessions?.find((item) => item.id === sessionId);
    if (!session) return;
    const project = store.projects.find((item) => item.id === session.projectId);
    if (!project || project.autoVerify !== true) return;
    const checks = project.verificationChecks ?? [];
    const turnId = sessionTurnIds.get(sessionId) ?? randomUUID();
    await runVerificationForSession({ session, project, checks, turnId });
  }

  async function cachedProjectFiles(
    cacheKey: string,
    targetPath: string,
  ): Promise<ProjectFileList> {
    const now = Date.now();
    const cached = fileListCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.list;
    const existing = fileListInflight.get(cacheKey);
    if (existing) return existing;
    const genAtStart = fileListGen.get(cacheKey) ?? 0;
    const promise = listProjectFiles({ projectPath: targetPath })
      .then((list) => {
        if ((fileListGen.get(cacheKey) ?? 0) === genAtStart) {
          fileListCache.set(cacheKey, { list, expiresAt: Date.now() + FILE_CACHE_TTL_MS });
        }
        return list;
      })
      .finally(() => {
        if (fileListInflight.get(cacheKey) === promise) fileListInflight.delete(cacheKey);
      });
    fileListInflight.set(cacheKey, promise);
    return promise;
  }

  function handleChatEvent(sessionId: string, event: ChatEvent): void {
    deps.emit(sessionId, event);
    if (event.kind !== 'text-delta') enqueueAppend(sessionId, event);
    if (event.kind === 'session') {
      adoptProviderSession({ sessionId, providerSessionId: event.providerSessionId });
    }
    trackProvisionalSession(sessionId, event);
    const owner = turnOwners.get(sessionId);
    if (event.kind === 'usage-limits' && owner) {
      streamUsage.set(owner.accountId, {
        provider: owner.provider,
        windows: event.windows,
        source: 'stream',
        fetchedAt: deps.usageDeps.now().toISOString(),
      });
      if (event.windows.some((window) => window.usedPercent >= 100)) {
        exhaustedAccounts.set(owner.accountId, exhaustionResetAt(event.windows));
      } else {
        exhaustedAccounts.delete(owner.accountId);
      }
    }
    if (event.kind === 'error') {
      lastErrorBySession.set(sessionId, event.message);
      if (owner && isRateLimitMessage(event.message)) {
        const windows = streamUsage.get(owner.accountId)?.windows ?? [];
        exhaustedAccounts.set(
          owner.accountId,
          exhaustionResetAt(windows) ?? exhaustedAccounts.get(owner.accountId) ?? null,
        );
      }
    }
    if (event.kind === 'verification') {
      if (event.status === 'failed') {
        enqueueInboxUpdate({
          sessionId,
          kind: 'failed',
          summary: 'Verificação pós-turno falhou.',
        });
      } else if (
        event.status === 'passed' &&
        (sessionId !== uiFocus.activeSessionId || !uiFocus.windowFocused)
      ) {
        enqueueInboxUpdate({
          sessionId,
          kind: 'completed',
          summary: 'Verificação pós-turno aprovada.',
        });
      }
    }
    if (event.kind === 'done') {
      turnOwners.delete(sessionId);
      const wasCancelled = cancelledTurns.delete(sessionId);
      const lastError = lastErrorBySession.get(sessionId);
      lastErrorBySession.delete(sessionId);
      invalidateProjectFiles(sessionId);
      if (event.isError && !wasCancelled) {
        const rateLimited = lastError ? isRateLimitMessage(lastError) : false;
        enqueueInboxUpdate({
          sessionId,
          kind: rateLimited ? 'waiting-input' : 'failed',
          summary: rateLimited
            ? 'Limite da conta atingido. Troque de conta ou execute handoff.'
            : (lastError ?? 'Turno encerrado com erro.'),
        });
      } else if (!event.isError && !wasCancelled) {
        if (owner) exhaustedAccounts.delete(owner.accountId);
        if (sessionId !== uiFocus.activeSessionId || !uiFocus.windowFocused) {
          enqueueInboxUpdate({
            sessionId,
            kind: 'completed',
            summary: 'Resposta concluída.',
          });
        }
        void maybeRunAutoVerification(sessionId).catch((error: unknown) => {
          console.error(`inova: failed to run verification of ${sessionId}`, error);
        });
      }
      if (owner && !deps.chat.accountsInUse().has(owner.accountId)) {
        void drainAccountQueue(owner.accountId).catch((error: unknown) => {
          console.error(`inova: failed to drain turn queue for ${owner.accountId}`, error);
        });
      }
    }
  }

  async function accountView(account: Account): Promise<AccountView> {
    const baseEnv = await deps.baseEnv();
    const { env } = buildLaunch({ account, cwd: account.homeDir, args: [], baseEnv });
    const [status, email] = await Promise.all([
      providers[account.provider].checkStatus({
        homeDir: account.homeDir,
        env,
        runner: deps.runner,
      }),
      readAccountEmail(account),
    ]);
    return { id: account.id, label: account.label, email, provider: account.provider, status };
  }

  async function savedAccountView(account: Account): Promise<AccountView> {
    try {
      return await accountView(account);
    } catch (error: unknown) {
      if (error instanceof Error) {
        return {
          id: account.id,
          label: account.label,
          email: await readAccountEmail(account),
          provider: account.provider,
          status: 'unknown',
        };
      }
      throw error;
    }
  }

  const loginFlow = createLoginFlowManager({
    sessions: deps.sessions,
    emit: (event) => deps.emitLogin?.(event),
    onAuthenticated: (accountId) => {
      modelsCache.delete(accountId);
    },
    checkStatus: async ({ account, baseEnv }) => {
      const { env } = buildLaunch({ account, cwd: account.homeDir, args: [], baseEnv });
      try {
        return await providers[account.provider].checkStatus({
          homeDir: account.homeDir,
          env,
          runner: deps.runner,
        });
      } catch (error: unknown) {
        if (error instanceof Error) return 'unknown';
        throw error;
      }
    },
  });

  async function startAccountLogin(account: Account): Promise<Result<StartedLogin>> {
    const adapter = providers[account.provider];
    const baseEnv = await deps.baseEnv();
    const file = await findBinary(adapter.binary, baseEnv['PATH'] ?? '');
    if (file === undefined) {
      return fail(`${adapter.binary} não encontrado. Instale: ${adapter.installHint}`);
    }
    const spec: LaunchSpec = buildLogin({ account, baseEnv });
    await adapter.prepareLaunch(account.homeDir, baseEnv['HOME']);
    const started = await loginFlow.start({ account, spec, file, baseEnv });
    return ok(started);
  }

  async function expandProjectCommand(input: {
    projectPath: string;
    prompt: string;
    keepClaudeLiteral: boolean;
  }): Promise<string> {
    const { projectPath, prompt, keepClaudeLiteral } = input;
    const parsed = splitLeadingSlash(prompt);
    if (parsed === null) return prompt;
    const commands = await listProjectCommands(projectPath);
    const command = commands.find((item) => item.name === parsed.name);
    if (command === undefined) return prompt;
    if (keepClaudeLiteral && command.source === 'claude') return prompt;
    return expandCommandPrompt(command.body, parsed.rest);
  }

  async function runTurn(input: {
    sessionId: string;
    prompt: string;
    account: Account;
    project: Project;
    file: string;
    baseEnv: NodeJS.ProcessEnv;
    extraDirs?: readonly string[];
  }): Promise<Result<null>> {
    const { sessionId, prompt, account, project } = input;
    verificationControllers.get(sessionId)?.abort();
    const store = await loadStore(deps.root);
    const session = requireSession(store, sessionId);
    if (session.archivedAt !== null) return fail(ARCHIVED_MESSAGE);
    const cwd = effectiveCwd(session, project);
    const turnId = randomUUID();
    sessionTurnIds.set(sessionId, turnId);
    cancelledTurns.delete(sessionId);
    const checkpoint = await createCheckpoint({ repoPath: cwd, sessionId, turnId });
    const parent = sessionsOf(store).find((item) => item.id === session.parentId);
    const { turn, newId } = decideTurn({
      session,
      parent,
      claude: account.provider === 'claude',
    });
    const persistNow = account.provider === 'claude' && newId !== null;
    const handoffPrefix = session.handoffContext?.trim();
    const commandPrompt = await expandProjectCommand({
      projectPath: project.path,
      prompt,
      keepClaudeLiteral: account.provider === 'claude' && !handoffPrefix,
    });
    const promptForCli = handoffPrefix
      ? `${handoffPrefix}\n\n---\n\nSolicitação do usuário:\n${commandPrompt}`
      : commandPrompt;
    await updateSession({
      root: deps.root,
      sessionId,
      patch: {
        ...(persistNow ? { providerSessionId: newId } : {}),
        ...(DEFAULT_TITLES.has(session.title) ? { title: titleFromPrompt(prompt) } : {}),
        ...(handoffPrefix ? { handoffContext: null } : {}),
      },
    });
    const executionMode = resolveExecutionMode({
      provider: account.provider,
      sessionMode: session.mode ?? null,
      defaultModes: store.defaultModes,
    });
    const modelConfig = resolveModelConfig({
      provider: account.provider,
      model: session.model ?? null,
      effort: session.effort ?? null,
      settings: await getSettings(deps.root),
    });
    const spec = buildChatTurn({
      account,
      cwd,
      prompt: promptForCli,
      turn,
      baseEnv: input.baseEnv,
      model: modelConfig.model,
      effort: modelConfig.effort,
      executionMode,
      extraDirs: input.extraDirs,
    });
    if (persistNow && newId !== null) {
      provisionalSessions.set(sessionId, { providerSessionId: newId, confirmed: false });
    }
    sessionProjects.set(sessionId, session.projectId);
    turnOwners.set(sessionId, { accountId: account.id, provider: account.provider });
    if (checkpoint !== null) {
      handleChatEvent(sessionId, {
        kind: 'checkpoint',
        turnId: checkpoint.turnId,
        ref: checkpoint.ref,
        createdAt: checkpoint.createdAt,
        skippedLargeFiles: checkpoint.skippedLargeFiles,
      });
    }
    handleChatEvent(sessionId, { kind: 'user', text: prompt, at: new Date().toISOString() });
    deps.chat.send({
      sessionId,
      accountId: account.id,
      provider: account.provider,
      file: input.file,
      spec,
    });
    return ok(null);
  }

  function runAutoArchive(): Promise<string[]> {
    return serialized(async () => {
      const { autoArchiveDays } = (await getSettings(deps.root)).sessions;
      if (autoArchiveDays === 0) return [];
      await inboxChain;
      const store = await loadStore(deps.root);
      const sessions = sessionsOf(store);
      const busyIds = new Set([
        ...sessions.filter((session) => deps.chat.isRunning(session.id)).map(({ id }) => id),
        ...(store.workspace?.openSessionIds ?? []),
        ...(uiFocus.activeSessionId === null ? [] : [uiFocus.activeSessionId]),
        ...[...inboxMap.values()].filter((item) => item.unread).map(({ sessionId }) => sessionId),
        ...turnQueue.list().map(({ sessionId }) => sessionId),
      ]);
      const expired = sessionsToAutoArchive({
        sessions,
        now: deps.usageDeps.now(),
        days: autoArchiveDays,
        busyIds,
      });
      for (const sessionId of expired) {
        await updateSession({ root: deps.root, sessionId, patch: { archived: true } });
      }
      return expired;
    });
  }

  return {
    handleChatEvent,
    runAutoArchive,
    listAccounts: (): Promise<Result<AccountView[]>> =>
      guarded(async () => {
        const store = await loadStore(deps.root);
        return ok(await Promise.all(store.accounts.map(savedAccountView)));
      }),
    addAccount: (input: unknown): Promise<Result<AccountView>> =>
      validated(input, parseNewAccount, async ({ provider, label }) => {
        const account = await serialized(() => addAccount({ root: deps.root, provider, label }));
        return ok(await savedAccountView(account));
      }),
    removeAccount: (input: unknown): Promise<Result<null>> =>
      validated(input, parseRemoval, ({ label, force }) =>
        serialized(async () => {
          const store = await loadStore(deps.root);
          const account = findAccount(store, label);
          if (account && deps.sessions.accountsInUse().has(account.id)) {
            return fail('Feche as abas desta conta antes de removê-la.');
          }
          if (account && deps.chat.accountsInUse().has(account.id)) {
            return fail('Pare os turnos desta conta antes de removê-la.');
          }
          const projectIds = new Set(
            store.projects.filter((item) => item.accountId === account?.id).map((item) => item.id),
          );
          const orphaned = sessionIdsOfProjects(store, projectIds);
          await removeAccount({ root: deps.root, label, force });
          removeSessionsRuntimeState(orphaned);
          await removeTranscripts(orphaned);
          return ok(null);
        }),
      ),
    listProjects: (): Promise<Result<ProjectView[]>> =>
      guarded(async () => {
        const store = await loadStore(deps.root);
        const views = await Promise.all(
          store.projects.flatMap((project) => {
            const account = store.accounts.find((item) => item.id === project.accountId);
            return account ? [projectView(project, account)] : [];
          }),
        );
        return ok(views);
      }),
    pickFolder: (): Promise<string | null> => deps.pickFolder(),
    pickAttachments: (input: unknown): Promise<Result<PickedAttachment[]>> =>
      validated(input, parseAttachmentPick, async ({ kind }) =>
        ok(await deps.pickAttachments(kind)),
      ),
    bindProject: (input: unknown): Promise<Result<ProjectView>> =>
      validated(input, parseBinding, ({ path, accountLabel }) =>
        serialized(async () => {
          const project = await bindProject({ root: deps.root, path, accountLabel });
          const account = requireAccount(await loadStore(deps.root), accountLabel);
          return ok(await projectView(project, account));
        }),
      ),
    unbindProject: (input: unknown): Promise<Result<null>> =>
      validated(input, parsePath, ({ path }) =>
        serialized(async () => {
          const resolved = await realPathOf(path).catch((error: unknown) => {
            if (error instanceof PathNotFoundError) return resolve(path);
            throw error;
          });
          const store = await loadStore(deps.root);
          const projectIds = new Set(
            store.projects.filter((item) => item.path === resolved).map((item) => item.id),
          );
          const orphaned = sessionIdsOfProjects(store, projectIds);
          if (orphaned.some((sessionId) => deps.chat.isRunning(sessionId))) {
            return fail('Pare os turnos deste projeto antes de desvinculá-lo.');
          }
          await unbindProject({ root: deps.root, path });
          removeSessionsRuntimeState(orphaned);
          await removeTranscripts(orphaned);
          return ok(null);
        }),
      ),
    listSessions: (input: unknown): Promise<Result<Session[]>> =>
      validated(input, parseProjectRef, async ({ projectId }) => {
        const store = await loadStore(deps.root);
        return ok(sessionsOf(store).filter((session) => session.projectId === projectId));
      }),
    createSession: (input: unknown): Promise<Result<Session>> =>
      validated(input, parseNewSession, ({ projectId, parentId, isolatedWorktree }) =>
        serialized(async () => {
          const store = await loadStore(deps.root);
          const project = store.projects.find((item) => item.id === projectId);
          const shouldIsolate =
            isolatedWorktree ?? (parentId === null && project?.autoWorktree === true);
          let parentBaseCommit: string | undefined;
          if (parentId !== null && shouldIsolate) {
            const parent = sessionsOf(store).find((item) => item.id === parentId);
            if (parent?.worktree) {
              const head = await tryRunGit({
                cwd: parent.worktree.path,
                args: ['rev-parse', '--verify', 'HEAD'],
              });
              if (head.ok) parentBaseCommit = head.stdout.trim();
            }
          }
          const created = await createSession({ root: deps.root, projectId, parentId });
          if (!shouldIsolate || !project) return ok(created);
          try {
            const worktree = await createSessionWorktree({
              root: deps.root,
              projectId: project.id,
              sessionId: created.id,
              projectPath: project.path,
              ...(parentBaseCommit ? { baseCommit: parentBaseCommit } : {}),
            });
            return ok(
              await updateSession({
                root: deps.root,
                sessionId: created.id,
                patch: { worktree },
              }),
            );
          } catch (error: unknown) {
            await deleteSession({ root: deps.root, sessionId: created.id });
            throw error;
          }
        }),
      ),
    updateSession: (input: unknown): Promise<Result<Session>> =>
      validated(input, parseSessionUpdate, ({ sessionId, title, archived, model, effort, mode }) =>
        serialized(async () => {
          const store = await loadStore(deps.root);
          const session = requireSession(store, sessionId);
          if (archived === true) {
            if ([...descendantIds(store, sessionId)].some((id) => deps.chat.isRunning(id))) {
              return fail('Pare o turno em andamento antes de arquivar.');
            }
          }
          if (effort !== undefined && effort !== null) {
            const project = store.projects.find((item) => item.id === session.projectId);
            const account = project
              ? resolveSessionAccount({ session, project, accounts: store.accounts })
              : undefined;
            if (account && !isEffortSupported(account.provider, effort)) {
              return fail('Nível de esforço não suportado por este provedor.');
            }
          }
          if (mode !== undefined && mode !== null) {
            const project = store.projects.find((item) => item.id === session.projectId);
            const account = project
              ? resolveSessionAccount({ session, project, accounts: store.accounts })
              : undefined;
            if (account && !isModeSupported(account.provider, mode)) {
              return fail('Modo não suportado por este provedor.');
            }
          }
          const patch = {
            ...(title === undefined ? {} : { title }),
            ...(archived === undefined ? {} : { archived }),
            ...(model === undefined ? {} : { model }),
            ...(effort === undefined ? {} : { effort }),
            ...(mode === undefined ? {} : { mode }),
          };
          return ok(await updateSession({ root: deps.root, sessionId, patch }));
        }),
      ),
    getDefaultModes: (): Promise<Result<Partial<Record<ProviderId, ExecutionMode>>>> =>
      guarded(async () => ok(await getDefaultModes(deps.root))),
    setDefaultMode: (input: unknown): Promise<Result<Partial<Record<ProviderId, ExecutionMode>>>> =>
      validated(input, parseDefaultMode, ({ provider, mode }) =>
        serialized(async () =>
          ok(await setDefaultProviderMode({ root: deps.root, provider, mode })),
        ),
      ),
    getSettings: (): Promise<Result<Settings>> =>
      guarded(async () => ok(await getSettings(deps.root))),
    updateSettings: (input: unknown): Promise<Result<Settings>> =>
      validated(input, parseSettingsPatch, (patch) =>
        serialized(async () => ok(await updateSettings({ root: deps.root, patch }))),
      ),
    sendTestNotification: (): Promise<Result<null>> =>
      guarded(async () => {
        if (!deps.notify) return fail('Notificações não estão disponíveis.');
        return deps.notify({ title: 'Inova', body: 'Notificação de teste' });
      }),
    openNotificationSettings: (): Promise<Result<null>> =>
      guarded(async () => {
        if (!deps.openNotificationSettings) {
          return fail('Abra os ajustes de notificação do sistema manualmente.');
        }
        await deps.openNotificationSettings();
        return ok(null);
      }),
    openDataFolder: (): Promise<Result<null>> =>
      guarded(async () => {
        if (!deps.openPath) return fail('Abrir a pasta de dados não está disponível.');
        await mkdir(deps.root, { recursive: true, mode: 0o700 });
        try {
          await deps.openPath(deps.root);
        } catch (error: unknown) {
          if (error instanceof Error) return fail('Não foi possível abrir a pasta de dados.');
          throw error;
        }
        return ok(null);
      }),
    getAppInfo: (): Promise<Result<{ version: string }>> =>
      guarded(async () =>
        deps.updates
          ? ok({ version: deps.updates.current })
          : fail('Versão do aplicativo indisponível.'),
      ),
    checkForUpdate: (): Promise<Result<UpdateInfo>> =>
      guarded(async () =>
        deps.updates ? deps.updates.check() : fail('Verificação de atualização indisponível.'),
      ),
    openExternalUrl: (input: unknown): Promise<Result<null>> =>
      validated(input, parseExternalUrl, async (url) => {
        if (!deps.openExternal) return fail('Abrir links não está disponível.');
        try {
          await deps.openExternal(url);
        } catch (error: unknown) {
          if (error instanceof Error) return fail('Não foi possível abrir o link.');
          throw error;
        }
        return ok(null);
      }),
    getWorkspace: (): Promise<Result<Workspace>> =>
      guarded(async () => ok(await getWorkspace(deps.root))),
    saveWorkspace: (input: unknown): Promise<Result<null>> =>
      validated(input, parseWorkspace, (workspace) =>
        serialized(async () => {
          await saveWorkspace({ root: deps.root, workspace });
          return ok(null);
        }),
      ),
    deleteSession: (input: unknown): Promise<Result<null>> =>
      validated(input, parseSessionDelete, ({ sessionId, force }) =>
        serialized(async () => {
          const store = await loadStore(deps.root);
          const target = requireSession(store, sessionId);
          const affected = descendantIds(store, sessionId);
          if ([...affected].some((id) => deps.chat.isRunning(id))) {
            return fail('Pare o turno em andamento antes de apagar.');
          }
          const project = store.projects.find((item) => item.id === target.projectId);
          const remainingWorktreePaths = new Set(
            sessionsOf(store)
              .filter((item) => !affected.has(item.id) && item.worktree)
              .map((item) => item.worktree!.path),
          );
          const worktreesToRemove = new Map<string, NonNullable<Session['worktree']>>();
          for (const item of sessionsOf(store)) {
            if (!affected.has(item.id) || !item.worktree) continue;
            if (remainingWorktreePaths.has(item.worktree.path)) continue;
            worktreesToRemove.set(item.worktree.path, item.worktree);
          }
          if (project) {
            if (!force) {
              for (const worktree of worktreesToRemove.values()) {
                const status = await getWorktreeStatus({
                  worktreePath: worktree.path,
                  baseCommit: worktree.baseCommit,
                }).catch(() => null);
                if (status?.dirty) {
                  throw new WorktreeError(
                    'dirty-worktree',
                    'O worktree possui alterações não aplicadas. Confirme o descarte para removê-lo.',
                  );
                }
              }
            }
            for (const worktree of worktreesToRemove.values()) {
              await removeSessionWorktree({ projectPath: project.path, worktree, force });
            }
            for (const id of affected) {
              await removeSessionCheckpoints({ repoPath: project.path, sessionId: id });
            }
          }
          removeSessionsRuntimeState([...affected]);
          const removed = await deleteSession({ root: deps.root, sessionId });
          await removeTranscripts(removed);
          return ok(null);
        }),
      ),
    getWorktreeStatus: (input: unknown): Promise<Result<WorktreeStatusView>> =>
      validated(input, parseSessionRef, async ({ sessionId }) => {
        const store = await loadStore(deps.root);
        const session = requireSession(store, sessionId);
        if (!session.worktree) return fail('Esta sessão não possui worktree isolado.');
        const status = await getWorktreeStatus({
          worktreePath: session.worktree.path,
          baseCommit: session.worktree.baseCommit,
        });
        return ok(status);
      }),
    applyWorktree: (input: unknown): Promise<Result<{ appliedFiles: string[] }>> =>
      validated(input, parseSessionRef, ({ sessionId }) =>
        serialized(async () => {
          const store = await loadStore(deps.root);
          const session = requireSession(store, sessionId);
          if (!session.worktree) return fail('Esta sessão não possui worktree isolado.');
          if (deps.chat.isRunning(sessionId)) {
            return fail('Pare o turno em andamento antes de aplicar o worktree.');
          }
          const project = store.projects.find((item) => item.id === session.projectId);
          if (!project) return fail('Projeto não encontrado.');
          const applied = await applyWorktreeToProject({
            projectPath: project.path,
            worktreePath: session.worktree.path,
            baseCommit: session.worktree.baseCommit,
          });
          invalidateProjectFiles(sessionId);
          return ok(applied);
        }),
      ),
    restoreCheckpoint: (input: unknown): Promise<Result<null>> =>
      validated(input, parseRestoreCheckpoint, ({ sessionId, ref, preserveFiles }) =>
        serialized(async () => {
          if (deps.chat.isRunning(sessionId)) {
            return fail('Pare o turno em andamento antes de restaurar o checkpoint.');
          }
          const store = await loadStore(deps.root);
          const session = requireSession(store, sessionId);
          const project = store.projects.find((item) => item.id === session.projectId);
          if (!project) return fail('Projeto não encontrado.');
          const cwd = effectiveCwd(session, project);
          await restoreCheckpoint({ repoPath: cwd, ref, preserveFiles });
          invalidateProjectFiles(sessionId);
          return ok(null);
        }),
      ),
    detectProjectChecks: (input: unknown): Promise<Result<VerificationCheck[]>> =>
      validated(input, parseProjectRef, async ({ projectId }) => {
        const store = await loadStore(deps.root);
        const project = store.projects.find((item) => item.id === projectId);
        if (!project) return fail('Projeto não encontrado.');
        return ok(await detectProjectChecks(project.path));
      }),
    updateProjectVerification: (input: unknown): Promise<Result<ProjectView>> =>
      validated(
        input,
        parseProjectVerification,
        ({ projectId, autoWorktree, autoVerify, verificationChecks }) =>
          serialized(async () => {
            const updated = await updateProjectConfig({
              root: deps.root,
              projectId,
              patch: {
                ...(autoWorktree === undefined ? {} : { autoWorktree }),
                ...(autoVerify === undefined ? {} : { autoVerify }),
                ...(verificationChecks === undefined ? {} : { verificationChecks }),
              },
            });
            const store = await loadStore(deps.root);
            const account = store.accounts.find((item) => item.id === updated.accountId);
            if (!account) return fail('Conta do projeto não encontrada.');
            return ok(await projectView(updated, account));
          }),
      ),
    runVerification: (input: unknown): Promise<Result<null>> =>
      validated(input, parseSessionRef, async ({ sessionId }) => {
        if (deps.chat.isRunning(sessionId)) return fail(BUSY_MESSAGE);
        const store = await loadStore(deps.root);
        const session = requireSession(store, sessionId);
        const project = store.projects.find((item) => item.id === session.projectId);
        if (!project) return fail('Projeto não encontrado.');
        const checks = project.verificationChecks ?? [];
        if (!checks.some((check) => check.enabled)) {
          return fail('Nenhuma verificação ativa configurada neste projeto.');
        }
        const turnId = sessionTurnIds.get(sessionId) ?? randomUUID();
        await runVerificationForSession({ session, project, checks, turnId });
        return ok(null);
      }),
    loadTranscript: (input: unknown): Promise<Result<ChatEvent[]>> =>
      validated(input, parseSessionRef, async ({ sessionId }) =>
        ok(await readTranscriptEvents(sessionId)),
      ),
    sendMessage: (input: unknown): Promise<Result<null>> =>
      validated(input, parseMessage, async ({ sessionId, prompt, extraDirs }) => {
        if (deps.chat.isRunning(sessionId)) return fail(BUSY_MESSAGE);
        const store = await loadStore(deps.root);
        const session = requireSession(store, sessionId);
        if (session.archivedAt !== null) return fail(ARCHIVED_MESSAGE);
        const project = store.projects.find((item) => item.id === session.projectId);
        const account = project
          ? resolveSessionAccount({ session, project, accounts: store.accounts })
          : undefined;
        if (!project || !account) return fail('Projeto não encontrado.');
        if (deps.chat.accountsInUse().has(account.id)) {
          return fail(
            'CONTA_OCUPADA: A conta já está executando outra sessão. Enfileire o turno ou troque de conta.',
          );
        }
        const entry = exhaustionEntry(account.id);
        if (entry !== null) {
          if (isFutureReset(entry.resetsAt)) return fail(exhaustedMessage(entry.resetsAt));
          const blocked = await recheckExhaustion({ account, resetsAt: entry.resetsAt });
          if (blocked !== null) return fail(blocked);
        }
        const adapter = providers[account.provider];
        const baseEnv = await deps.baseEnv();
        const file = await findBinary(adapter.binary, baseEnv['PATH'] ?? '');
        if (file === undefined) {
          return fail(`${adapter.binary} não encontrado. Instale: ${adapter.installHint}`);
        }
        await adapter.prepareLaunch(account.homeDir, baseEnv['HOME']);
        return serialized(async () => {
          if (deps.chat.isRunning(sessionId)) return fail(BUSY_MESSAGE);
          if (deps.chat.accountsInUse().has(account.id)) {
            return fail(
              'CONTA_OCUPADA: A conta já está executando outra sessão. Enfileire o turno ou troque de conta.',
            );
          }
          return runTurn({
            sessionId,
            prompt,
            account,
            project,
            file,
            baseEnv,
            extraDirs,
          });
        });
      }),
    enqueueTurn: (input: unknown): Promise<Result<QueuedTurn>> =>
      validated(input, parseMessage, async ({ sessionId, prompt }) => {
        const store = await loadStore(deps.root);
        const session = requireSession(store, sessionId);
        if (session.archivedAt !== null) return fail(ARCHIVED_MESSAGE);
        const project = store.projects.find((item) => item.id === session.projectId);
        const account = project
          ? resolveSessionAccount({ session, project, accounts: store.accounts })
          : undefined;
        if (!project || !account) return fail('Projeto não encontrado.');
        const queued = turnQueue.enqueue({ sessionId, accountId: account.id, prompt });
        emitQueueSnapshot();
        if (!deps.chat.accountsInUse().has(account.id) && !isAccountExhausted(account.id)) {
          void drainAccountQueue(account.id).catch((error: unknown) => {
            console.error(`inova: failed to drain turn queue for ${account.id}`, error);
          });
        }
        return ok(queued);
      }),
    cancelQueuedTurn: (input: unknown): Promise<Result<null>> =>
      validated(input, parseTurnRef, async ({ turnId }) => {
        turnQueue.cancelByTurnId(turnId);
        emitQueueSnapshot();
        return ok(null);
      }),
    listTurnQueue: (): Promise<Result<QueuedTurn[]>> => guarded(async () => ok(turnQueue.list())),
    switchSessionAccount: (
      input: unknown,
    ): Promise<Result<{ session: Session; hadHistory: boolean }>> =>
      validated(input, parseSwitchAccount, ({ sessionId, accountId, generateHandoff }) =>
        serialized(async () => {
          if (deps.chat.isRunning(sessionId)) {
            return fail('Pare o turno em andamento antes de trocar de conta.');
          }
          const store = await loadStore(deps.root);
          const session = requireSession(store, sessionId);
          const project = store.projects.find((item) => item.id === session.projectId);
          if (!project) return fail('Projeto não encontrado.');
          const targetAccount = store.accounts.find((item) => item.id === accountId);
          if (!targetAccount) return fail('Conta de destino não encontrada.');
          const sourceAccount = resolveSessionAccount({
            session,
            project,
            accounts: store.accounts,
          });
          const events = await readTranscriptEvents(sessionId);
          const hadHistory = events.length > 0 || session.providerSessionId !== null;
          let handoffContext: string | null | undefined;
          if (hadHistory && generateHandoff !== false && sourceAccount) {
            const gitSummary = await gitSummaryFor(effectiveCwd(session, project));
            handoffContext = buildHandoffContext({
              events,
              gitSummary,
              fromProvider: sourceAccount.provider,
              toProvider: targetAccount.provider,
            });
          }
          const updated = await updateSession({
            root: deps.root,
            sessionId,
            patch: {
              accountIdOverride: accountId,
              providerSessionId: null,
              ...(handoffContext === undefined ? {} : { handoffContext }),
            },
          });
          if (turnQueue.reassignSessionAccount({ sessionId, accountId })) {
            emitQueueSnapshot();
            void drainAccountQueue(accountId).catch((error: unknown) => {
              console.error(`inova: failed to drain turn queue for ${accountId}`, error);
            });
          }
          return ok({ session: updated, hadHistory });
        }),
      ),
    handoffSession: (
      input: unknown,
    ): Promise<Result<{ session: Session; handoffContext: string }>> =>
      validated(input, parseHandoffSession, ({ sessionId, targetAccountId, createWorktree }) =>
        serialized(async () => {
          const store = await loadStore(deps.root);
          const session = requireSession(store, sessionId);
          const project = store.projects.find((item) => item.id === session.projectId);
          if (!project) return fail('Projeto não encontrado.');
          const targetAccount = store.accounts.find((item) => item.id === targetAccountId);
          if (!targetAccount) return fail('Conta de destino não encontrada.');
          const sourceAccount = resolveSessionAccount({
            session,
            project,
            accounts: store.accounts,
          });
          if (!sourceAccount) return fail('Conta de origem não encontrada.');
          const events = await readTranscriptEvents(sessionId);
          const gitSummary = await gitSummaryFor(effectiveCwd(session, project));
          const handoffContext = buildHandoffContext({
            events,
            gitSummary,
            fromProvider: sourceAccount.provider,
            toProvider: targetAccount.provider,
          });
          const created = await createSession({
            root: deps.root,
            projectId: project.id,
            parentId: session.id,
            title: `${session.title} (handoff)`,
            accountIdOverride: targetAccount.id,
            handoffContext,
            worktree: createWorktree ? null : (session.worktree ?? null),
          });
          if (createWorktree) {
            try {
              const worktree = await createSessionWorktree({
                root: deps.root,
                projectId: project.id,
                sessionId: created.id,
                projectPath: project.path,
              });
              const updated = await updateSession({
                root: deps.root,
                sessionId: created.id,
                patch: { worktree },
              });
              return ok({ session: updated, handoffContext });
            } catch (error: unknown) {
              await deleteSession({ root: deps.root, sessionId: created.id });
              throw error;
            }
          }
          return ok({ session: created, handoffContext });
        }),
      ),
    forkSession: (
      input: unknown,
    ): Promise<Result<{ session: Session; strategy: 'native-claude' | 'summary-handoff' }>> =>
      validated(
        input,
        parseForkSession,
        ({ sessionId, turnIndex, targetAccountId, copyWorktreeFiles }) =>
          serialized(async () => {
            const store = await loadStore(deps.root);
            const session = requireSession(store, sessionId);
            const project = store.projects.find((item) => item.id === session.projectId);
            if (!project) return fail('Projeto não encontrado.');
            const sourceAccount = resolveSessionAccount({
              session,
              project,
              accounts: store.accounts,
            });
            if (!sourceAccount) return fail('Conta de origem não encontrada.');
            const targetAccount = targetAccountId
              ? store.accounts.find((item) => item.id === targetAccountId)
              : sourceAccount;
            if (!targetAccount) return fail('Conta de destino não encontrada.');
            const events = await readTranscriptEvents(sessionId);
            const sliced = sliceTranscriptToTurn(events, turnIndex);
            const useNativeClaude =
              sliced.isLatestTurn &&
              targetAccount.id === sourceAccount.id &&
              targetAccount.provider === 'claude' &&
              session.providerSessionId !== null;
            const strategy: 'native-claude' | 'summary-handoff' = useNativeClaude
              ? 'native-claude'
              : 'summary-handoff';
            const gitSummary = useNativeClaude
              ? undefined
              : await gitSummaryFor(effectiveCwd(session, project));
            const handoffContext = useNativeClaude
              ? null
              : buildHandoffContext({
                  events: sliced.slicedEvents,
                  gitSummary,
                  fromProvider: sourceAccount.provider,
                  toProvider: targetAccount.provider,
                });
            const created = await createSession({
              root: deps.root,
              projectId: project.id,
              parentId: session.id,
              title: `${session.title} (fork)`,
              accountIdOverride: targetAccount.id,
              handoffContext,
              worktree: null,
            });
            let resultSession = created;
            if (copyWorktreeFiles) {
              let createdWorktree: Session['worktree'] = null;
              try {
                const sourceCwd = effectiveCwd(session, project);
                const latestSnapshot = sliced.isLatestTurn
                  ? await createCheckpoint({
                      repoPath: sourceCwd,
                      sessionId: created.id,
                      turnId: 'fork-latest',
                    })
                  : null;
                createdWorktree = await createSessionWorktree({
                  root: deps.root,
                  projectId: project.id,
                  sessionId: created.id,
                  projectPath: project.path,
                });
                const checkpointToApply =
                  latestSnapshot?.ref ??
                  sliced.postTurnCheckpointRef ??
                  sliced.preTurnCheckpointRef;
                if (checkpointToApply) {
                  await restoreCheckpoint({
                    repoPath: createdWorktree.path,
                    ref: checkpointToApply,
                  });
                }
                resultSession = await updateSession({
                  root: deps.root,
                  sessionId: created.id,
                  patch: { worktree: createdWorktree },
                });
              } catch (error: unknown) {
                if (createdWorktree) {
                  await removeSessionWorktree({
                    projectPath: project.path,
                    worktree: createdWorktree,
                    force: true,
                  }).catch(() => undefined);
                }
                await removeSessionCheckpoints({
                  repoPath: project.path,
                  sessionId: created.id,
                }).catch(() => undefined);
                await deleteSession({ root: deps.root, sessionId: created.id });
                throw error;
              }
            }
            await writeTranscriptEvents(resultSession.id, sliced.slicedEvents);
            return ok({ session: resultSession, strategy });
          }),
      ),
    rewindSession: (input: unknown): Promise<Result<{ text: string }>> =>
      validated(input, parseRewindSession, ({ sessionId, turnIndex }) =>
        serialized(async () => {
          if (deps.chat.isRunning(sessionId)) {
            return fail('Pare o turno em andamento antes de voltar a conversa.');
          }
          const store = await loadStore(deps.root);
          const session = requireSession(store, sessionId);
          const project = store.projects.find((item) => item.id === session.projectId);
          if (!project) return fail('Projeto não encontrado.');
          const account = resolveSessionAccount({ session, project, accounts: store.accounts });
          if (!account) return fail('Conta da sessão não encontrada.');
          const events = await readTranscriptEvents(sessionId);
          const truncated = truncateTranscriptAtTurn(events, turnIndex);
          if (!truncated) return fail('Turno não encontrado.');
          const { kept, removedUserText, checkpointRef, skippedLargeFiles } = truncated;
          const cwd = effectiveCwd(session, project);
          const sharesRunningTree = sessionsOf(store).some((other) => {
            if (other.id === sessionId || !deps.chat.isRunning(other.id)) return false;
            const otherProject = store.projects.find((item) => item.id === other.projectId);
            return otherProject !== undefined && effectiveCwd(other, otherProject) === cwd;
          });
          if (sharesRunningTree) {
            return fail('Outra sessão está rodando neste repositório. Pare-a antes de retroceder.');
          }
          if (
            checkpointRef !== null &&
            !(await checkpointExists({ repoPath: cwd, ref: checkpointRef }))
          ) {
            return fail(
              'O checkpoint deste turno não existe mais. Não é possível desfazer os arquivos.',
            );
          }
          try {
            if (checkpointRef !== null) {
              await restoreCheckpoint({
                repoPath: cwd,
                ref: checkpointRef,
                preserveFiles: skippedLargeFiles,
              });
            }
            const hasUserTurns = kept.some((event) => event.kind === 'user');
            const handoffContext = hasUserTurns
              ? buildHandoffContext({
                  events: kept,
                  gitSummary: await gitSummaryFor(cwd),
                  fromProvider: account.provider,
                  toProvider: account.provider,
                })
              : null;
            provisionalSessions.delete(sessionId);
            await updateSession({
              root: deps.root,
              sessionId,
              patch: {
                providerSessionId: null,
                handoffContext,
                ...(session.parentId === null ? {} : { detachedFromParent: true }),
              },
            });
            await writeTranscriptEvents(sessionId, kept);
          } finally {
            if (checkpointRef !== null) invalidateProjectFiles(sessionId);
          }
          return ok({ text: removedUserText });
        }),
      ),
    clearSession: (input: unknown): Promise<Result<null>> =>
      validated(input, parseSessionRef, ({ sessionId }) =>
        serialized(async () => {
          if (deps.chat.isRunning(sessionId)) {
            return fail('Pare o turno em andamento antes de limpar a conversa.');
          }
          const session = requireSession(await loadStore(deps.root), sessionId);
          provisionalSessions.delete(sessionId);
          await updateSession({
            root: deps.root,
            sessionId,
            patch: {
              providerSessionId: null,
              handoffContext: null,
              ...(session.parentId === null ? {} : { detachedFromParent: true }),
            },
          });
          await writeTranscriptEvents(sessionId, []);
          return ok(null);
        }),
      ),
    recordFeedback: (input: unknown): Promise<Result<null>> =>
      validated(input, parseRecordFeedback, ({ sessionId, turnIndex, value }) =>
        serialized(async () => {
          requireSession(await loadStore(deps.root), sessionId);
          enqueueAppend(sessionId, { kind: 'feedback', turnIndex, value });
          await flushTranscript(sessionId);
          return ok(null);
        }),
      ),
    listExternalSessions: (input: unknown): Promise<Result<ExternalSessionView[]>> =>
      validated(input, parseProjectRef, async ({ projectId }) => {
        const store = await loadStore(deps.root);
        const project = store.projects.find((item) => item.id === projectId);
        if (!project) return fail('Projeto não encontrado.');
        const env = await deps.baseEnv();
        const imported = importedProviderSessionIds(store, projectId);
        const found = await Promise.all(
          IMPORT_PROVIDERS.map((provider) =>
            listExternalSessions({
              provider,
              sourceHome: defaultCliHome(provider, env),
              projectPath: project.path,
            }),
          ),
        );
        return ok(
          found.flat().map((session) => ({ ...session, imported: imported.has(session.id) })),
        );
      }),
    importSessions: (input: unknown): Promise<Result<Session[]>> =>
      validated(input, parseImportSessions, ({ projectId, provider, accountId, sessionIds }) =>
        serialized(async () => {
          const store = await loadStore(deps.root);
          const project = store.projects.find((item) => item.id === projectId);
          if (!project) return fail('Projeto não encontrado.');
          const account = store.accounts.find((item) => item.id === accountId);
          if (account?.provider !== provider) {
            return fail('Escolha uma conta do mesmo provedor da sessão.');
          }
          const imported = importedProviderSessionIds(store, projectId);
          if (sessionIds.some((sessionId) => imported.has(sessionId))) {
            return fail('Uma das sessões selecionadas já foi importada neste projeto.');
          }
          const sourceHome = defaultCliHome(provider, await deps.baseEnv());
          const created: Session[] = [];
          for (const sessionId of sessionIds) {
            const { title, events } = await importExternalSession({
              provider,
              sourceHome,
              targetHome: account.homeDir,
              projectPath: project.path,
              sessionId,
            });
            const session = await createSession({
              root: deps.root,
              projectId,
              title,
              providerSessionId: sessionId,
              accountIdOverride: account.id === project.accountId ? null : account.id,
              worktree: null,
            });
            await writeTranscriptEvents(session.id, events);
            created.push(session);
          }
          return ok(created);
        }),
      ),
    listInbox: (): Promise<Result<InboxItem[]>> =>
      guarded(async () => {
        await inboxChain;
        return ok(sortedInbox());
      }),
    markInboxRead: (input: unknown): Promise<Result<InboxItem[]>> =>
      validated(input, parseSessionRef, async ({ sessionId }) => {
        await inboxChain;
        const current = inboxMap.get(sessionId);
        if (current && current.unread) {
          inboxMap.set(sessionId, { ...current, unread: false });
          emitInboxSnapshot();
        }
        return ok(sortedInbox());
      }),
    clearReadInbox: (): Promise<Result<InboxItem[]>> =>
      guarded(async () => {
        await inboxChain;
        for (const [id, item] of inboxMap) {
          if (!item.unread) inboxMap.delete(id);
        }
        emitInboxSnapshot();
        return ok(sortedInbox());
      }),
    reportUiFocus: (input: unknown): void => {
      const parsed = parseUiFocus(input);
      if (parsed) uiFocus = parsed;
    },
    cancelTurn: (sessionId: string): void => {
      cancelledTurns.add(sessionId);
      verificationControllers.get(sessionId)?.abort();
      deps.chat.cancel(sessionId);
    },
    getUsage: (input: unknown) =>
      validated(input, parseUsageRequest, async ({ accountLabel }) => {
        const account = requireAccount(await loadStore(deps.root), accountLabel);
        try {
          const snapshot = await readUsage({ account, deps: deps.usageDeps });
          if (snapshot.source === 'api') {
            streamUsage.set(account.id, snapshot);
            if (!snapshot.windows.some((window) => window.usedPercent >= 100)) {
              exhaustedAccounts.delete(account.id);
            }
          }
          return ok(snapshot);
        } catch (error: unknown) {
          if (!(error instanceof Error)) throw error;
          const cached = streamUsage.get(account.id);
          if (account.provider === 'claude' && cached) return ok(cached);
          if (error instanceof UsageError) throw error;
          return fail('Não foi possível ler o consumo.');
        }
      }),
    listModels: (input: unknown): Promise<Result<ProviderModels>> =>
      validated(input, parseUsageRequest, async ({ accountLabel }) => {
        const account = requireAccount(await loadStore(deps.root), accountLabel);
        const cached = modelsCache.get(account.id);
        if (cached) return ok(cached);
        const fallback = PROVIDER_MODELS[account.provider];
        if (account.provider !== 'gemini' && account.provider !== 'opencode') {
          modelsCache.set(account.id, fallback);
          return ok(fallback);
        }
        const baseEnv = await deps.baseEnv();
        const adapter = providers[account.provider];
        const file = await findBinary(adapter.binary, baseEnv['PATH'] ?? '');
        if (file === undefined) return ok(fallback);
        await adapter.prepareLaunch(account.homeDir, baseEnv['HOME']);
        const { env } = buildLaunch({ account, cwd: account.homeDir, args: [], baseEnv });
        try {
          const result = await deps.runner.run({ command: file, args: ['models'], env });
          if ('notFound' in result || result.exitCode !== 0) return ok(fallback);
          const parsed =
            account.provider === 'gemini'
              ? parseAgyModelsOutput(result.stdout)
              : parseOpenCodeModelsOutput(result.stdout);
          if (parsed.length === 0) return ok(fallback);
          const dynamicCatalog: ProviderModels = { ...fallback, models: parsed };
          modelsCache.set(account.id, dynamicCatalog);
          return ok(dynamicCatalog);
        } catch (error: unknown) {
          if (error instanceof Error) return ok(fallback);
          throw error;
        }
      }),
    searchFiles: (input: unknown) =>
      validated(input, parseFileSearch, async ({ projectId, query, limit, sessionId }) => {
        const store = await loadStore(deps.root);
        const project = store.projects.find((item) => item.id === projectId);
        if (!project) return fail('Projeto não encontrado.');
        const session = sessionId
          ? sessionsOf(store).find((item) => item.id === sessionId && item.projectId === project.id)
          : undefined;
        const targetPath = session ? effectiveCwd(session, project) : project.path;
        const cacheKey = session?.worktree ? `${project.id}:${session.id}` : project.id;
        const list = await cachedProjectFiles(cacheKey, targetPath);
        return ok({
          files: rankProjectFiles(list.files, query, limit),
          truncated: list.truncated,
        });
      }),
    listCommands: (input: unknown) =>
      validated(input, parseProjectRef, async ({ projectId }) => {
        const store = await loadStore(deps.root);
        const project = store.projects.find((item) => item.id === projectId);
        if (!project) return fail('Projeto não encontrado.');
        return ok(await listProjectCommands(project.path));
      }),
    startComparison: (input: unknown) =>
      validated(input, parseStartComparison, (parsed) =>
        serialized(async () => {
          const store = await loadStore(deps.root);
          const project = store.projects.find((item) => item.id === parsed.projectId);
          if (!project) return fail('Projeto não encontrado.');
          const leftAccount = store.accounts.find((item) => item.id === parsed.leftAccountId);
          const rightAccount = store.accounts.find((item) => item.id === parsed.rightAccountId);
          if (!leftAccount || !rightAccount) {
            return fail('Conta selecionada para comparação não encontrada.');
          }
          if (leftAccount.id === rightAccount.id) {
            return fail('Selecione duas contas diferentes para executar em paralelo.');
          }
          const inUse = deps.chat.accountsInUse();
          if (inUse.has(leftAccount.id) || inUse.has(rightAccount.id)) {
            return fail('Uma das contas selecionadas já está executando outra sessão.');
          }

          const baseEnv = await deps.baseEnv();
          const leftAdapter = providers[leftAccount.provider];
          const rightAdapter = providers[rightAccount.provider];
          if (parsed.leftEffort && !isEffortSupported(leftAccount.provider, parsed.leftEffort)) {
            return fail(`Esforço não suportado para ${leftAccount.provider}: ${parsed.leftEffort}`);
          }
          if (parsed.rightEffort && !isEffortSupported(rightAccount.provider, parsed.rightEffort)) {
            return fail(
              `Esforço não suportado para ${rightAccount.provider}: ${parsed.rightEffort}`,
            );
          }
          const [leftFile, rightFile] = await Promise.all([
            findBinary(leftAdapter.binary, baseEnv['PATH'] ?? ''),
            findBinary(rightAdapter.binary, baseEnv['PATH'] ?? ''),
          ]);
          if (leftFile === undefined) {
            return fail(
              `${leftAdapter.binary} não encontrado. Instale: ${leftAdapter.installHint}`,
            );
          }
          if (rightFile === undefined) {
            return fail(
              `${rightAdapter.binary} não encontrado. Instale: ${rightAdapter.installHint}`,
            );
          }
          await Promise.all([
            leftAdapter.prepareLaunch(leftAccount.homeDir, baseEnv['HOME']),
            rightAdapter.prepareLaunch(rightAccount.homeDir, baseEnv['HOME']),
          ]);

          const groupId = randomUUID();
          const pair = await createComparisonWorktrees({
            root: deps.root,
            projectId: project.id,
            projectPath: project.path,
            groupId,
            leftSessionId: `cmp-${groupId.slice(0, 8)}-a`,
            rightSessionId: `cmp-${groupId.slice(0, 8)}-b`,
          });

          const cleanupPairOnError = async () => {
            await Promise.all([
              removeSessionWorktree({
                projectPath: project.path,
                worktree: pair.left,
                force: true,
              }),
              removeSessionWorktree({
                projectPath: project.path,
                worktree: pair.right,
                force: true,
              }),
            ]).catch(() => undefined);
          };

          let leftSession: Session;
          let rightSession: Session;
          try {
            leftSession = await createSession({
              root: deps.root,
              projectId: project.id,
              title: `Comparação A · ${leftAccount.label}`,
              accountIdOverride: leftAccount.id,
              comparisonGroupId: groupId,
              comparisonRole: 'left',
              worktree: pair.left,
              ...(parsed.leftModel === undefined ? {} : { model: parsed.leftModel }),
              ...(parsed.leftEffort === undefined ? {} : { effort: parsed.leftEffort }),
              ...(parsed.leftMode === undefined ? {} : { mode: parsed.leftMode }),
            });
            try {
              rightSession = await createSession({
                root: deps.root,
                projectId: project.id,
                title: `Comparação B · ${rightAccount.label}`,
                accountIdOverride: rightAccount.id,
                comparisonGroupId: groupId,
                comparisonRole: 'right',
                worktree: pair.right,
                ...(parsed.rightModel === undefined ? {} : { model: parsed.rightModel }),
                ...(parsed.rightEffort === undefined ? {} : { effort: parsed.rightEffort }),
                ...(parsed.rightMode === undefined ? {} : { mode: parsed.rightMode }),
              });
            } catch (error: unknown) {
              await deleteSession({ root: deps.root, sessionId: leftSession.id }).catch(
                () => undefined,
              );
              throw error;
            }
          } catch (error: unknown) {
            await cleanupPairOnError();
            throw error;
          }

          const [leftRun, rightRun] = await Promise.all([
            runTurn({
              sessionId: leftSession.id,
              prompt: parsed.prompt,
              account: leftAccount,
              project,
              file: leftFile,
              baseEnv,
            }),
            runTurn({
              sessionId: rightSession.id,
              prompt: parsed.prompt,
              account: rightAccount,
              project,
              file: rightFile,
              baseEnv,
            }),
          ]);
          if (!leftRun.ok || !rightRun.ok) {
            deps.chat.cancel(leftSession.id);
            deps.chat.cancel(rightSession.id);
            removeSessionsRuntimeState([leftSession.id, rightSession.id]);
            await Promise.all([
              deleteSession({ root: deps.root, sessionId: leftSession.id }).catch(() => undefined),
              deleteSession({ root: deps.root, sessionId: rightSession.id }).catch(() => undefined),
              removeTranscripts([leftSession.id, rightSession.id]).catch(() => undefined),
              removeSessionCheckpoints({ repoPath: project.path, sessionId: leftSession.id }).catch(
                () => undefined,
              ),
              removeSessionCheckpoints({
                repoPath: project.path,
                sessionId: rightSession.id,
              }).catch(() => undefined),
            ]);
            await cleanupPairOnError();
            return fail(
              !leftRun.ok
                ? leftRun.message
                : !rightRun.ok
                  ? rightRun.message
                  : 'Falha ao iniciar comparação.',
            );
          }

          return ok({ groupId, left: leftSession, right: rightSession });
        }),
      ),
    getComparisonDiff: (input: unknown) =>
      validated(input, parseComparisonRef, async ({ groupId }) => {
        const store = await loadStore(deps.root);
        const groupSessions = sessionsOf(store).filter(
          (item) => item.comparisonGroupId === groupId,
        );
        const left = groupSessions.find((item) => item.comparisonRole === 'left');
        const right = groupSessions.find((item) => item.comparisonRole === 'right');
        if (!left?.worktree || !right?.worktree) {
          return fail('Comparação ou worktrees não encontrados.');
        }
        return ok(
          await getComparisonDiff({
            groupId,
            leftSessionId: left.id,
            leftWorktree: left.worktree,
            rightSessionId: right.id,
            rightWorktree: right.worktree,
          }),
        );
      }),
    resolveComparison: (input: unknown) =>
      validated(input, parseResolveComparison, ({ groupId, winner, cleanupWorktrees }) =>
        serialized(async () => {
          const store = await loadStore(deps.root);
          const groupSessions = sessionsOf(store).filter(
            (item) => item.comparisonGroupId === groupId,
          );
          const left = groupSessions.find((item) => item.comparisonRole === 'left');
          const right = groupSessions.find((item) => item.comparisonRole === 'right');
          if (!left?.worktree || !right?.worktree) {
            return fail('Comparação ou worktrees não encontrados.');
          }
          if (deps.chat.isRunning(left.id) || deps.chat.isRunning(right.id)) {
            return fail('Aguarde ambos os agentes concluírem antes de aplicar o vencedor.');
          }
          const project = store.projects.find((item) => item.id === left.projectId);
          if (!project) return fail('Projeto não encontrado.');
          const winnerSession = winner === 'left' ? left : right;
          const loserSession = winner === 'left' ? right : left;
          const winnerWorktree = winnerSession.worktree!;
          const loserWorktree = loserSession.worktree ?? null;
          const shouldCleanup = cleanupWorktrees ?? false;

          const applied = await applyComparisonWinner({
            projectPath: project.path,
            winnerWorktree,
            loserWorktree,
            cleanupWorktrees: shouldCleanup,
          });
          if (shouldCleanup) {
            await updateSession({
              root: deps.root,
              sessionId: winnerSession.id,
              patch: { worktree: null },
            });
            await updateSession({
              root: deps.root,
              sessionId: loserSession.id,
              patch: { worktree: null },
            });
          }
          invalidateFilesByProjectId(project.id);
          return ok({ appliedFiles: applied.appliedFiles, winnerSessionId: winnerSession.id });
        }),
      ),
    previewProfileSync: (input: unknown) =>
      validated(
        input,
        parsePreviewProfileSync,
        async ({ projectId, accountIds, rulesSource, sourceAccountId }) => {
          const store = await loadStore(deps.root);
          const project = store.projects.find((item) => item.id === projectId);
          if (!project) return fail('Projeto não encontrado.');
          const selected = accountIds
            ? store.accounts.filter((account) => accountIds.includes(account.id))
            : store.accounts;
          const previewAccounts =
            sourceAccountId && !selected.some((account) => account.id === sourceAccountId)
              ? [...selected, ...store.accounts.filter((account) => account.id === sourceAccountId)]
              : selected;
          const fullPreview = await previewProfileSync({
            projectPath: project.path,
            accounts: previewAccounts,
            ...(rulesSource === undefined ? {} : { rulesSource }),
            ...(sourceAccountId === undefined ? {} : { sourceAccountId }),
          });
          if (!accountIds) return ok(fullPreview);
          return ok({
            ...fullPreview,
            items: fullPreview.items.filter(
              (item) => item.scope === 'rules' || accountIds.includes(item.accountId ?? ''),
            ),
          });
        },
      ),
    applyProfileSync: (input: unknown) =>
      validated(
        input,
        parseApplyProfileSync,
        ({ projectId, accountIds, rulesSource, sourceAccountId, approvedIds, rulesStrategy }) =>
          serialized(async () => {
            const store = await loadStore(deps.root);
            const project = store.projects.find((item) => item.id === projectId);
            if (!project) return fail('Projeto não encontrado.');
            const selected = accountIds
              ? store.accounts.filter((account) => accountIds.includes(account.id))
              : store.accounts;
            const sourceExtra =
              sourceAccountId && !selected.some((account) => account.id === sourceAccountId)
                ? store.accounts.filter((account) => account.id === sourceAccountId)
                : [];
            const baseEnv = await deps.baseEnv();
            return ok(
              await applyProfileSync({
                root: deps.root,
                projectPath: project.path,
                accounts: [...selected, ...sourceExtra],
                approvedIds:
                  sourceExtra.length > 0
                    ? approvedIds.filter((id) => !sourceExtra.some((s) => `mcp:${s.id}` === id))
                    : approvedIds,
                runner: deps.runner,
                baseEnv,
                ...(rulesSource === undefined ? {} : { rulesSource }),
                ...(sourceAccountId === undefined ? {} : { sourceAccountId }),
                ...(rulesStrategy === undefined ? {} : { rulesStrategy }),
              }),
            );
          }),
      ),
    handlePtyData: (sessionId: string, chunk: string): void =>
      loginFlow.handlePtyData(sessionId, chunk),
    handlePtyExit: (sessionId: string, exitCode: number): Promise<void> =>
      loginFlow.handlePtyExit(sessionId, exitCode),
    startLogin: (input: unknown): Promise<Result<StartedLogin>> =>
      validated(input, parseUsageRequest, async ({ accountLabel }) => {
        const account = requireAccount(await loadStore(deps.root), accountLabel);
        return startAccountLogin(account);
      }),
    submitLoginCode: (input: unknown): Promise<Result<null>> =>
      validated(input, parseLoginCode, async ({ sessionId, code }) =>
        loginFlow.submitCode({ sessionId, code })
          ? ok(null)
          : fail('Sessão de login não encontrada ou já encerrada.'),
      ),
    cancelLogin: (sessionId: string): void => loginFlow.cancel(sessionId),
  };
}
