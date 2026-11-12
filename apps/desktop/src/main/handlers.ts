import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { addAccount, findAccount, removeAccount } from '@inova/core/accounts';
import type { ChatEvent, UsageSnapshot } from '@inova/core/chat-types';
import { buildChatTurn, buildLaunch, buildLogin } from '@inova/core/launch';
import type { ChatTurn, LaunchSpec } from '@inova/core/launch';
import { PathNotFoundError, bindProject, realPathOf, unbindProject } from '@inova/core/projects';
import { providers } from '@inova/core/providers';
import type { CommandRunner } from '@inova/core/providers';
import { SessionError, createSession, deleteSession, updateSession } from '@inova/core/sessions';
import { loadStore } from '@inova/core/store';
import type { Account, ProviderId, Session, Store } from '@inova/core/types';
import { UsageError, readUsage } from '@inova/core/usage';
import type { UsageDeps } from '@inova/core/usage';
import type { OpenedSession, ProjectView, AccountView, Result } from '../shared/api.js';
import { parseTranscriptLine } from './chat.js';
import type { ChatRunner } from './chat.js';
import type { SessionManager } from './sessions.js';
import { findBinary } from './shell-env.js';
import {
  fail,
  guarded,
  ok,
  parseBinding,
  parseLoginLaunch,
  parseMessage,
  parseNewAccount,
  parseNewSession,
  parsePath,
  parseProjectRef,
  parseRemoval,
  parseRename,
  parseSessionRef,
  parseUsageRequest,
  requireAccount,
  validated,
} from './validation.js';
import type { Size } from './validation.js';

export interface HandlerDeps {
  root: string;
  runner: CommandRunner;
  sessions: SessionManager;
  chat: ChatRunner;
  usageDeps: UsageDeps;
  emit: (sessionId: string, event: ChatEvent) => void;
  baseEnv: () => Promise<NodeJS.ProcessEnv>;
  pickFolder: () => Promise<string | null>;
}

const DEFAULT_TITLES: ReadonlySet<string> = new Set(['Nova sessão', 'Subsessão']);
const TITLE_CHARS = 60;
const BUSY_MESSAGE = 'Já existe um turno em andamento nesta sessão.';

export function isExternalWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function projectView(project: { id: string; path: string }, account: Account): ProjectView {
  return {
    id: project.id,
    path: project.path,
    accountLabel: account.label,
    provider: account.provider,
  };
}

function sessionsOf(store: Store): Session[] {
  return store.sessions ?? [];
}

function descendantIds(store: Store, sessionId: string): Set<string> {
  const removed = new Set([sessionId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const session of sessionsOf(store)) {
      if (session.parentId !== null && removed.has(session.parentId) && !removed.has(session.id)) {
        removed.add(session.id);
        grew = true;
      }
    }
  }
  return removed;
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
  const turnOwners = new Map<string, { accountId: string; provider: ProviderId }>();
  const provisionalSessions = new Map<string, { providerSessionId: string; confirmed: boolean }>();
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
    if (event.kind === 'done') turnOwners.delete(sessionId);
  }

  async function accountView(account: Account): Promise<AccountView> {
    const baseEnv = await deps.baseEnv();
    const { env } = buildLaunch({ account, cwd: account.homeDir, args: [], baseEnv });
    const status = await providers[account.provider].checkStatus({
      homeDir: account.homeDir,
      env,
      runner: deps.runner,
    });
    return { id: account.id, label: account.label, provider: account.provider, status };
  }

  async function savedAccountView(account: Account): Promise<AccountView> {
    try {
      return await accountView(account);
    } catch (error: unknown) {
      if (error instanceof Error) {
        return {
          id: account.id,
          label: account.label,
          provider: account.provider,
          status: 'unknown',
        };
      }
      throw error;
    }
  }

  async function startLogin(input: {
    account: Account;
    size: Size;
  }): Promise<Result<OpenedSession>> {
    const adapter = providers[input.account.provider];
    const baseEnv = await deps.baseEnv();
    const file = await findBinary(adapter.binary, baseEnv['PATH'] ?? '');
    if (file === undefined) {
      return fail(`${adapter.binary} não encontrado. Instale: ${adapter.installHint}`);
    }
    const spec: LaunchSpec = buildLogin({ account: input.account, baseEnv });
    const sessionId = deps.sessions.open({
      spec,
      file,
      accountId: input.account.id,
      ...input.size,
    });
    return ok({ sessionId, title: `login · ${input.account.label}` });
  }

  async function runTurn(input: {
    sessionId: string;
    prompt: string;
    account: Account;
    projectPath: string;
    file: string;
    baseEnv: NodeJS.ProcessEnv;
  }): Promise<Result<null>> {
    const { sessionId, prompt, account } = input;
    const store = await loadStore(deps.root);
    const session = requireSession(store, sessionId);
    const parent = sessionsOf(store).find((item) => item.id === session.parentId);
    const { turn, newId } = decideTurn({
      session,
      parent,
      claude: account.provider === 'claude',
    });
    const persistNow = account.provider !== 'codex' && newId !== null;
    await updateSession({
      root: deps.root,
      sessionId,
      patch: {
        ...(persistNow ? { providerSessionId: newId } : {}),
        ...(DEFAULT_TITLES.has(session.title) ? { title: titleFromPrompt(prompt) } : {}),
      },
    });
    const spec = buildChatTurn({
      account,
      cwd: input.projectPath,
      prompt,
      turn,
      baseEnv: input.baseEnv,
    });
    if (persistNow && newId !== null) {
      provisionalSessions.set(sessionId, { providerSessionId: newId, confirmed: false });
    }
    turnOwners.set(sessionId, { accountId: account.id, provider: account.provider });
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
        return ok(
          store.projects.flatMap((project) => {
            const account = store.accounts.find((item) => item.id === project.accountId);
            return account ? [projectView(project, account)] : [];
          }),
        );
      }),
    pickFolder: (): Promise<string | null> => deps.pickFolder(),
    bindProject: (input: unknown): Promise<Result<ProjectView>> =>
      validated(input, parseBinding, ({ path, accountLabel }) =>
        serialized(async () => {
          const project = await bindProject({ root: deps.root, path, accountLabel });
          const account = requireAccount(await loadStore(deps.root), accountLabel);
          return ok(projectView(project, account));
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
      validated(input, parseNewSession, ({ projectId, parentId }) =>
        serialized(async () => ok(await createSession({ root: deps.root, projectId, parentId }))),
      ),
    renameSession: (input: unknown): Promise<Result<Session>> =>
      validated(input, parseRename, ({ sessionId, title }) =>
        serialized(async () =>
          ok(await updateSession({ root: deps.root, sessionId, patch: { title } })),
        ),
      ),
    deleteSession: (input: unknown): Promise<Result<null>> =>
      validated(input, parseSessionRef, ({ sessionId }) =>
        serialized(async () => {
          const store = await loadStore(deps.root);
          requireSession(store, sessionId);
          const affected = descendantIds(store, sessionId);
          if ([...affected].some((id) => deps.chat.isRunning(id))) {
            return fail('Pare o turno em andamento antes de apagar.');
          }
          const removed = await deleteSession({ root: deps.root, sessionId });
          await removeTranscripts(removed);
          return ok(null);
        }),
      ),
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
        const project = store.projects.find((item) => item.id === session.projectId);
        const account = store.accounts.find((item) => item.id === project?.accountId);
        if (!project || !account) return fail('Projeto não encontrado.');
        const adapter = providers[account.provider];
        const baseEnv = await deps.baseEnv();
        const file = await findBinary(adapter.binary, baseEnv['PATH'] ?? '');
        if (file === undefined) {
          return fail(`${adapter.binary} não encontrado. Instale: ${adapter.installHint}`);
        }
        await adapter.prepareLaunch(account.homeDir);
        return serialized(async () => {
          if (deps.chat.isRunning(sessionId)) return fail(BUSY_MESSAGE);
          return runTurn({
            sessionId,
            prompt,
            account,
            projectPath: project.path,
            file,
            baseEnv,
          });
        });
      }),
    cancelTurn: (sessionId: string): void => deps.chat.cancel(sessionId),
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
    openLogin: (input: unknown): Promise<Result<OpenedSession>> =>
      validated(input, parseLoginLaunch, async ({ accountLabel, ...size }) => {
        const account = requireAccount(await loadStore(deps.root), accountLabel);
        return startLogin({ account, size });
      }),
  };
}
