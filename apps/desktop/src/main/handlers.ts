import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { addAccount, findAccount, removeAccount } from '@inova/core/accounts';
import type { ChatEvent, UsageSnapshot } from '@inova/core/chat-types';
import { listProjectCommands } from '@inova/core/commands';
import { listProjectFiles, rankProjectFiles, type ProjectFileList } from '@inova/core/files';
import {
  createCheckpoint,
  removeSessionCheckpoints,
  restoreCheckpoint,
} from '@inova/core/git-checkpoints';
import {
  applyWorktreeToProject,
  createSessionWorktree,
  getWorktreeStatus,
  removeSessionWorktree,
} from '@inova/core/git-worktree';
import { buildChatTurn, buildLaunch, buildLogin } from '@inova/core/launch';
import type { ChatTurn, LaunchSpec } from '@inova/core/launch';
import {
  PROVIDER_MODELS,
  isEffortSupported,
  parseAgyModelsOutput,
  parseOpenCodeModelsOutput,
} from '@inova/core/models';
import type { ProviderModels } from '@inova/core/models';
import { isModeSupported, resolveExecutionMode } from '@inova/core/modes';
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
  SessionError,
  createSession,
  deleteSession,
  descendantIds,
  effectiveCwd,
  getDefaultModes,
  getWorkspace,
  saveWorkspace,
  setDefaultProviderMode,
  updateSession,
} from '@inova/core/sessions';
import { loadStore } from '@inova/core/store';
import type {
  Account,
  ExecutionMode,
  Project,
  ProviderId,
  Session,
  Store,
  VerificationCheck,
  Workspace,
} from '@inova/core/types';
import { UsageError, readUsage } from '@inova/core/usage';
import type { UsageDeps } from '@inova/core/usage';
import { detectProjectChecks, runVerificationChecks } from '@inova/core/verification';
import type {
  AccountView,
  LoginEvent,
  ProjectView,
  Result,
  StartedLogin,
  WorktreeStatusView,
} from '../shared/api.js';
import { parseTranscriptLine } from './chat.js';
import type { ChatRunner } from './chat.js';
import { createLoginFlowManager } from './login-flow.js';
import type { SessionManager } from './sessions.js';
import { findBinary } from './shell-env.js';
import {
  fail,
  guarded,
  ok,
  parseBinding,
  parseDefaultMode,
  parseFileSearch,
  parseLoginCode,
  parseMessage,
  parseNewAccount,
  parseNewSession,
  parsePath,
  parseProjectRef,
  parseProjectVerification,
  parseRemoval,
  parseRestoreCheckpoint,
  parseSessionDelete,
  parseSessionRef,
  parseSessionUpdate,
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
  baseEnv: () => Promise<NodeJS.ProcessEnv>;
  pickFolder: () => Promise<string | null>;
}

const DEFAULT_TITLES: ReadonlySet<string> = new Set(['Nova sessão', 'Subsessão']);
const TITLE_CHARS = 60;
const FILE_CACHE_TTL_MS = 5_000;
const BUSY_MESSAGE = 'Já existe um turno em andamento nesta sessão.';
const ARCHIVED_MESSAGE = 'Desarquive a sessão antes de enviar mensagens.';

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
  if (claude && parent?.providerSessionId) {
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
  const sessionProjects = new Map<string, string>();
  const turnOwners = new Map<string, { accountId: string; provider: ProviderId }>();
  const provisionalSessions = new Map<string, { providerSessionId: string; confirmed: boolean }>();
  const sessionTurnIds = new Map<string, string>();
  const cancelledTurns = new Set<string>();
  const verificationControllers = new Map<string, AbortController>();
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
      fileListCache.delete(projectId);
      const prefix = `${projectId}:`;
      for (const key of fileListCache.keys()) {
        if (key.startsWith(prefix)) fileListCache.delete(key);
      }
      return;
    }
    fileListCache.clear();
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
      if (controller.signal.aborted) return;
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
    const promise = listProjectFiles({ projectPath: targetPath })
      .then((list) => {
        fileListCache.set(cacheKey, { list, expiresAt: Date.now() + FILE_CACHE_TTL_MS });
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
    }
    if (event.kind === 'done') {
      turnOwners.delete(sessionId);
      const wasCancelled = cancelledTurns.delete(sessionId);
      invalidateProjectFiles(sessionId);
      if (!event.isError && !wasCancelled) {
        void maybeRunAutoVerification(sessionId).catch((error: unknown) => {
          console.error(`inova: failed to run verification of ${sessionId}`, error);
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

  async function runTurn(input: {
    sessionId: string;
    prompt: string;
    account: Account;
    project: Project;
    file: string;
    baseEnv: NodeJS.ProcessEnv;
  }): Promise<Result<null>> {
    const { sessionId, prompt, account, project } = input;
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
    await updateSession({
      root: deps.root,
      sessionId,
      patch: {
        ...(persistNow ? { providerSessionId: newId } : {}),
        ...(DEFAULT_TITLES.has(session.title) ? { title: titleFromPrompt(prompt) } : {}),
      },
    });
    const executionMode = resolveExecutionMode({
      provider: account.provider,
      sessionMode: session.mode ?? null,
      defaultModes: store.defaultModes,
    });
    const spec = buildChatTurn({
      account,
      cwd,
      prompt,
      turn,
      baseEnv: input.baseEnv,
      model: session.model ?? null,
      effort: session.effort ?? null,
      executionMode,
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

  return {
    handleChatEvent,
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
          const created = await createSession({ root: deps.root, projectId, parentId });
          if (!shouldIsolate || !project) return ok(created);
          try {
            const worktree = await createSessionWorktree({
              root: deps.root,
              projectId: project.id,
              sessionId: created.id,
              projectPath: project.path,
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
            const account = store.accounts.find((item) => item.id === project?.accountId);
            if (account && !isEffortSupported(account.provider, effort)) {
              return fail('Nível de esforço não suportado por este provedor.');
            }
          }
          if (mode !== undefined && mode !== null) {
            const project = store.projects.find((item) => item.id === session.projectId);
            const account = store.accounts.find((item) => item.id === project?.accountId);
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
            for (const worktree of worktreesToRemove.values()) {
              await removeSessionWorktree({ projectPath: project.path, worktree, force });
            }
            for (const id of affected) {
              await removeSessionCheckpoints({ repoPath: project.path, sessionId: id });
            }
          }
          for (const id of affected) {
            verificationControllers.get(id)?.abort();
            verificationControllers.delete(id);
            sessionTurnIds.delete(id);
            cancelledTurns.delete(id);
          }
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
      validated(input, parseSessionRef, async ({ sessionId }) => {
        await flushTranscript(sessionId);
        let raw: string;
        try {
          raw = await readFile(transcriptPath(sessionId), 'utf8');
        } catch (error: unknown) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ok([]);
          throw error;
        }
        const events = raw.split('\n').flatMap((line) => parseTranscriptLine(line) ?? []);
        return ok(events);
      }),
    sendMessage: (input: unknown): Promise<Result<null>> =>
      validated(input, parseMessage, async ({ sessionId, prompt }) => {
        if (deps.chat.isRunning(sessionId)) return fail(BUSY_MESSAGE);
        const store = await loadStore(deps.root);
        const session = requireSession(store, sessionId);
        if (session.archivedAt !== null) return fail(ARCHIVED_MESSAGE);
        const project = store.projects.find((item) => item.id === session.projectId);
        const account = store.accounts.find((item) => item.id === project?.accountId);
        if (!project || !account) return fail('Projeto não encontrado.');
        const adapter = providers[account.provider];
        const baseEnv = await deps.baseEnv();
        const file = await findBinary(adapter.binary, baseEnv['PATH'] ?? '');
        if (file === undefined) {
          return fail(`${adapter.binary} não encontrado. Instale: ${adapter.installHint}`);
        }
        await adapter.prepareLaunch(account.homeDir, baseEnv['HOME']);
        return serialized(async () => {
          if (deps.chat.isRunning(sessionId)) return fail(BUSY_MESSAGE);
          return runTurn({
            sessionId,
            prompt,
            account,
            project,
            file,
            baseEnv,
          });
        });
      }),
    cancelTurn: (sessionId: string): void => {
      cancelledTurns.add(sessionId);
      verificationControllers.get(sessionId)?.abort();
      deps.chat.cancel(sessionId);
    },
    getUsage: (input: unknown) =>
      validated(input, parseUsageRequest, async ({ accountLabel }) => {
        const account = requireAccount(await loadStore(deps.root), accountLabel);
        try {
          return ok(await readUsage({ account, deps: deps.usageDeps }));
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
