import { randomUUID } from 'node:crypto';
import {
  EMPTY_SESSION_USAGE_TOTALS,
  addTurnToUsageTotals,
  type TurnCostDelta,
} from './cost-tracking.js';
import { MAX_PINNED_MEMORY_CHARS } from './handoff.js';
import { isEffortLevel } from './models.js';
import { isExecutionMode, isModeSupported } from './modes.js';
import { normalizeOrchestratorConfig } from './orchestrator.js';
import { loadStore, saveStore, withStoreLock } from './store.js';
import type {
  Account,
  EffortLevel,
  ExecutionMode,
  Project,
  ProviderId,
  Session,
  SessionOrchestratorConfig,
  SessionUsageTotals,
  SessionWorktree,
  Store,
  Workspace,
} from './types.js';

type SessionErrorCode =
  | 'project-not-found'
  | 'parent-not-found'
  | 'not-found'
  | 'invalid-title'
  | 'invalid-model'
  | 'invalid-effort'
  | 'invalid-mode'
  | 'invalid-workspace'
  | 'invalid-pinned-memory'
  | 'invalid-orchestrator';

const MAX_TITLE_LENGTH = 200;
const MAX_MODEL_LENGTH = 200;
const MAX_OPEN_SESSIONS = 50;

export class SessionError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

function sessionsOf(store: Store): Session[] {
  store.sessions ??= [];
  return store.sessions;
}

function requireSession(store: Store, sessionId: string): Session {
  const session = sessionsOf(store).find((item) => item.id === sessionId);
  if (!session) throw new SessionError('not-found', `Session not found: ${sessionId}`);
  return session;
}

export function descendantIds(store: Store, sessionId: string): Set<string> {
  const ids = new Set([sessionId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const session of sessionsOf(store)) {
      if (session.parentId !== null && ids.has(session.parentId) && !ids.has(session.id)) {
        ids.add(session.id);
        grew = true;
      }
    }
  }
  return ids;
}

const MS_PER_DAY = 86_400_000;

function rootIdOf(sessionsById: ReadonlyMap<string, Session>, sessionId: string): string {
  const visited = new Set<string>();
  let id = sessionId;
  for (;;) {
    visited.add(id);
    const parentId = sessionsById.get(id)?.parentId;
    if (!parentId || visited.has(parentId) || !sessionsById.has(parentId)) return id;
    id = parentId;
  }
}

export function sessionsToAutoArchive(input: {
  sessions: readonly Session[];
  now: Date;
  days: number;
  busyIds: ReadonlySet<string>;
}): string[] {
  const { sessions, now, days, busyIds } = input;
  if (days <= 0) return [];
  const cutoff = now.getTime() - days * MS_PER_DAY;
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const recentIds = sessions
    .filter((session) => Date.parse(session.updatedAt) >= cutoff)
    .map((session) => session.id);
  const busyRoots = new Set([...busyIds, ...recentIds].map((id) => rootIdOf(sessionsById, id)));
  return sessions
    .filter(
      (session) =>
        session.parentId === null &&
        session.archivedAt === null &&
        Date.parse(session.updatedAt) < cutoff &&
        !busyRoots.has(session.id),
    )
    .map((session) => session.id);
}

function dropFromWorkspace(store: Store, ids: ReadonlySet<string>): void {
  const { workspace } = store;
  if (!workspace) return;
  store.workspace = {
    openSessionIds: workspace.openSessionIds.filter((id) => !ids.has(id)),
    activeSessionId:
      workspace.activeSessionId !== null && ids.has(workspace.activeSessionId)
        ? null
        : workspace.activeSessionId,
  };
}

function isSafeId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id !== '' &&
    id !== '.' &&
    id !== '..' &&
    !id.includes('/') &&
    !id.includes('\\')
  );
}

function sanitizeWorkspace(store: Store, workspace: Workspace): Workspace {
  const live = new Set(
    sessionsOf(store)
      .filter((session) => session.archivedAt === null)
      .map((session) => session.id),
  );
  const openSessionIds = [...new Set(workspace.openSessionIds)]
    .filter((id) => live.has(id))
    .slice(0, MAX_OPEN_SESSIONS);
  const { activeSessionId } = workspace;
  return {
    openSessionIds,
    activeSessionId:
      activeSessionId !== null && openSessionIds.includes(activeSessionId) ? activeSessionId : null,
  };
}

export async function getWorkspace(root: string): Promise<Workspace> {
  const store = await loadStore(root);
  return sanitizeWorkspace(store, store.workspace ?? { openSessionIds: [], activeSessionId: null });
}

export async function saveWorkspace(ctx: { root: string; workspace: Workspace }): Promise<void> {
  const { openSessionIds, activeSessionId } = ctx.workspace;
  if (
    !Array.isArray(openSessionIds) ||
    !openSessionIds.every(isSafeId) ||
    (activeSessionId !== null && !isSafeId(activeSessionId))
  ) {
    throw new SessionError('invalid-workspace', 'Invalid workspace');
  }
  await withStoreLock(ctx.root, async () => {
    const store = await loadStore(ctx.root);
    store.workspace = sanitizeWorkspace(store, ctx.workspace);
    await saveStore(ctx.root, store);
  });
}

function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed === '' || trimmed.length > MAX_TITLE_LENGTH) {
    throw new SessionError('invalid-title', `Title must have 1 to ${MAX_TITLE_LENGTH} characters`);
  }
  return trimmed;
}

function normalizeModel(model: string | null): string | null {
  if (model === null) return null;
  const trimmed = model.trim();
  if (trimmed === '' || trimmed.length > MAX_MODEL_LENGTH) {
    throw new SessionError('invalid-model', `Model must have 1 to ${MAX_MODEL_LENGTH} characters`);
  }
  return trimmed;
}

function normalizePinnedMemory(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_PINNED_MEMORY_CHARS) {
    throw new SessionError(
      'invalid-pinned-memory',
      `Pinned memory must have at most ${MAX_PINNED_MEMORY_CHARS} characters`,
    );
  }
  return trimmed;
}

function normalizeSessionOrchestrator(
  input: SessionOrchestratorConfig | null,
): SessionOrchestratorConfig | null {
  try {
    return normalizeOrchestratorConfig(input);
  } catch (error: unknown) {
    throw new SessionError(
      'invalid-orchestrator',
      error instanceof Error ? error.message : 'Invalid orchestrator configuration',
    );
  }
}

function providerForSession(
  store: Store,
  projectId: string,
  accountIdOverride?: string | null,
): ProviderId | null {
  if (accountIdOverride) {
    const overridden = store.accounts.find((item) => item.id === accountIdOverride);
    if (overridden) return overridden.provider;
  }
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) return null;
  const account = store.accounts.find((item) => item.id === project.accountId);
  return account?.provider ?? null;
}

export function resolveSessionAccount(input: {
  session: Pick<Session, 'accountIdOverride'>;
  project: Pick<Project, 'accountId'>;
  accounts: readonly Account[];
}): Account | undefined {
  const { session, project, accounts } = input;
  if (session.accountIdOverride) {
    const found = accounts.find((account) => account.id === session.accountIdOverride);
    if (found) return found;
  }
  return accounts.find((account) => account.id === project.accountId);
}

export function effectiveCwd(
  session: Pick<Session, 'worktree'>,
  project: Pick<Project, 'path'>,
): string {
  return session.worktree?.path ?? project.path;
}

export async function createSession(ctx: {
  root: string;
  projectId: string;
  parentId?: string | null;
  title?: string;
  providerSessionId?: string | null;
  accountIdOverride?: string | null;
  handoffContext?: string | null;
  pinnedMemory?: string | null;
  pinnedMemoryHash?: string | null;
  detachedFromParent?: boolean;
  comparisonGroupId?: string | null;
  comparisonRole?: 'left' | 'right' | null;
  model?: string | null;
  effort?: EffortLevel | null;
  mode?: ExecutionMode | null;
  worktree?: SessionWorktree | null;
  orchestrator?: SessionOrchestratorConfig | null;
  usageTotals?: SessionUsageTotals | null;
  now?: () => Date;
}): Promise<Session> {
  return withStoreLock(ctx.root, async () => {
    const store = await loadStore(ctx.root);
    const project = store.projects.find((item) => item.id === ctx.projectId);
    if (!project) {
      throw new SessionError('project-not-found', `Project not found: ${ctx.projectId}`);
    }
    const parentId = ctx.parentId ?? null;
    let parentWorktree: SessionWorktree | null = null;
    let parentAccountOverride: string | null = null;
    if (parentId !== null) {
      const parent = sessionsOf(store).find((item) => item.id === parentId);
      if (parent?.projectId !== ctx.projectId) {
        throw new SessionError('parent-not-found', `Parent session not found: ${parentId}`);
      }
      parentWorktree = parent.worktree ?? null;
      parentAccountOverride = parent.accountIdOverride ?? null;
    }
    const resolvedAccountOverride =
      ctx.accountIdOverride !== undefined ? ctx.accountIdOverride : parentAccountOverride;
    const provider = providerForSession(store, ctx.projectId, resolvedAccountOverride);
    const resolvedModel = normalizeModel(ctx.model ?? null);
    const resolvedPinnedMemory =
      ctx.pinnedMemory === undefined ? undefined : normalizePinnedMemory(ctx.pinnedMemory);
    const resolvedOrchestrator =
      ctx.orchestrator === undefined ? undefined : normalizeSessionOrchestrator(ctx.orchestrator);
    const resolvedEffort = ctx.effort ?? null;
    if (resolvedEffort !== null && !isEffortLevel(resolvedEffort)) {
      throw new SessionError('invalid-effort', `Invalid effort level: ${String(resolvedEffort)}`);
    }
    const inheritedMode =
      ctx.mode !== undefined
        ? ctx.mode
        : provider
          ? (store.defaultModes?.[provider] ?? null)
          : null;
    if (
      inheritedMode !== null &&
      (!isExecutionMode(inheritedMode) || (provider && !isModeSupported(provider, inheritedMode)))
    ) {
      throw new SessionError('invalid-mode', `Invalid mode: ${String(inheritedMode)}`);
    }
    const timestamp = (ctx.now?.() ?? new Date()).toISOString();
    const session: Session = {
      id: randomUUID(),
      projectId: ctx.projectId,
      parentId,
      title: ctx.title ?? (parentId === null ? 'Nova sessão' : 'Subsessão'),
      providerSessionId: ctx.providerSessionId ?? null,
      ...(resolvedAccountOverride === null ? {} : { accountIdOverride: resolvedAccountOverride }),
      ...(ctx.handoffContext ? { handoffContext: ctx.handoffContext } : {}),
      ...(resolvedPinnedMemory === undefined ? {} : { pinnedMemory: resolvedPinnedMemory }),
      ...(ctx.pinnedMemoryHash === undefined ? {} : { pinnedMemoryHash: ctx.pinnedMemoryHash }),
      ...(ctx.detachedFromParent === undefined
        ? {}
        : { detachedFromParent: ctx.detachedFromParent }),
      ...(ctx.comparisonGroupId ? { comparisonGroupId: ctx.comparisonGroupId } : {}),
      ...(ctx.comparisonRole ? { comparisonRole: ctx.comparisonRole } : {}),
      model: resolvedModel,
      effort: resolvedEffort,
      mode: inheritedMode,
      worktree: ctx.worktree !== undefined ? ctx.worktree : parentWorktree,
      ...(resolvedOrchestrator === undefined ? {} : { orchestrator: resolvedOrchestrator }),
      usageTotals: ctx.usageTotals ?? { ...EMPTY_SESSION_USAGE_TOTALS },
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
    };
    sessionsOf(store).push(session);
    await saveStore(ctx.root, store);
    return session;
  });
}

export async function listSessions(ctx: { root: string; projectId: string }): Promise<Session[]> {
  const store = await loadStore(ctx.root);
  return sessionsOf(store).filter((session) => session.projectId === ctx.projectId);
}

export async function getSession(ctx: { root: string; sessionId: string }): Promise<Session> {
  return requireSession(await loadStore(ctx.root), ctx.sessionId);
}

export async function updateSession(ctx: {
  root: string;
  sessionId: string;
  patch: Partial<
    Pick<
      Session,
      | 'title'
      | 'providerSessionId'
      | 'accountIdOverride'
      | 'handoffContext'
      | 'pinnedMemory'
      | 'pinnedMemoryHash'
      | 'detachedFromParent'
      | 'model'
      | 'effort'
      | 'mode'
      | 'worktree'
      | 'orchestrator'
    >
  > & {
    archived?: boolean;
  };
  now?: () => Date;
}): Promise<Session> {
  return withStoreLock(ctx.root, async () => {
    const store = await loadStore(ctx.root);
    const session = requireSession(store, ctx.sessionId);
    const {
      title,
      providerSessionId,
      accountIdOverride,
      handoffContext,
      pinnedMemory,
      pinnedMemoryHash,
      detachedFromParent,
      model,
      effort,
      mode,
      worktree,
      orchestrator,
      archived,
    } = ctx.patch;
    const timestamp = (ctx.now?.() ?? new Date()).toISOString();
    if (title !== undefined) session.title = normalizeTitle(title);
    if (providerSessionId !== undefined) {
      session.providerSessionId = providerSessionId;
      if (providerSessionId === null && pinnedMemoryHash === undefined) {
        session.pinnedMemoryHash = null;
      }
    }
    if (accountIdOverride !== undefined) {
      const prevProvider = providerForSession(store, session.projectId, session.accountIdOverride);
      session.accountIdOverride = accountIdOverride;
      const newProvider = providerForSession(store, session.projectId, accountIdOverride);
      if (prevProvider !== newProvider) {
        session.model = null;
        session.effort = null;
      }
      if (session.mode && newProvider && !isModeSupported(newProvider, session.mode)) {
        session.mode = store.defaultModes?.[newProvider] ?? null;
      }
    }
    if (handoffContext !== undefined) session.handoffContext = handoffContext;
    if (pinnedMemory !== undefined) session.pinnedMemory = normalizePinnedMemory(pinnedMemory);
    if (pinnedMemoryHash !== undefined) session.pinnedMemoryHash = pinnedMemoryHash;
    if (detachedFromParent !== undefined) session.detachedFromParent = detachedFromParent;
    if (model !== undefined) session.model = normalizeModel(model);
    if (worktree !== undefined) session.worktree = worktree;
    if (orchestrator !== undefined) {
      const normalized = normalizeSessionOrchestrator(orchestrator);
      if (normalized === null) {
        session.orchestrator = null;
      } else {
        const prev = session.orchestrator ?? null;
        const targetChanged =
          prev !== null &&
          (prev.accountId !== normalized.accountId || prev.model !== normalized.model);
        const explicitProviderSessionId = orchestrator?.providerSessionId;
        const nextProviderSessionId =
          explicitProviderSessionId !== undefined
            ? explicitProviderSessionId
            : targetChanged
              ? null
              : (prev?.providerSessionId ?? null);
        session.orchestrator = { ...normalized, providerSessionId: nextProviderSessionId };
      }
    }
    if (effort !== undefined) {
      if (effort !== null && !isEffortLevel(effort)) {
        throw new SessionError('invalid-effort', `Invalid effort: ${String(effort)}`);
      }
      session.effort = effort;
    }
    if (mode !== undefined) {
      const provider = providerForSession(store, session.projectId, session.accountIdOverride);
      if (
        mode !== null &&
        (!isExecutionMode(mode) || (provider && !isModeSupported(provider, mode)))
      ) {
        throw new SessionError(
          'invalid-mode',
          `Modo não suportado por este provedor: ${String(mode)}`,
        );
      }
      session.mode = mode;
    }
    if (archived !== undefined) {
      const affected = descendantIds(store, session.id);
      for (const item of sessionsOf(store)) {
        if (affected.has(item.id)) item.archivedAt = archived ? timestamp : null;
      }
      if (archived) dropFromWorkspace(store, affected);
    }
    session.updatedAt = timestamp;
    await saveStore(ctx.root, store);
    return session;
  });
}

export async function deleteSession(ctx: { root: string; sessionId: string }): Promise<string[]> {
  return withStoreLock(ctx.root, async () => {
    const store = await loadStore(ctx.root);
    requireSession(store, ctx.sessionId);
    const removed = descendantIds(store, ctx.sessionId);
    store.sessions = sessionsOf(store).filter((session) => !removed.has(session.id));
    dropFromWorkspace(store, removed);
    await saveStore(ctx.root, store);
    return [...removed];
  });
}

export function removeSessionsOfProjects(store: Store, projectIds: ReadonlySet<string>): void {
  if (!store.sessions) return;
  const removed = new Set(
    store.sessions.filter((session) => projectIds.has(session.projectId)).map((s) => s.id),
  );
  store.sessions = store.sessions.filter((session) => !removed.has(session.id));
  dropFromWorkspace(store, removed);
}

export async function getDefaultModes(
  root: string,
): Promise<Partial<Record<ProviderId, ExecutionMode>>> {
  const store = await loadStore(root);
  return { ...(store.defaultModes ?? {}) };
}

export async function setDefaultProviderMode(ctx: {
  root: string;
  provider: ProviderId;
  mode: ExecutionMode;
}): Promise<Partial<Record<ProviderId, ExecutionMode>>> {
  if (!isExecutionMode(ctx.mode) || !isModeSupported(ctx.provider, ctx.mode)) {
    throw new SessionError('invalid-mode', 'Modo não suportado por este provedor.');
  }
  return withStoreLock(ctx.root, async () => {
    const store = await loadStore(ctx.root);
    store.defaultModes = { ...(store.defaultModes ?? {}), [ctx.provider]: ctx.mode };
    await saveStore(ctx.root, store);
    return { ...store.defaultModes };
  });
}

export async function recordSessionTurnUsage(ctx: {
  root: string;
  sessionId: string;
  turn: TurnCostDelta;
}): Promise<void> {
  return withStoreLock(ctx.root, async () => {
    const store = await loadStore(ctx.root);
    const session = sessionsOf(store).find((item) => item.id === ctx.sessionId);
    if (!session) return;
    session.usageTotals = addTurnToUsageTotals(
      session.usageTotals ?? EMPTY_SESSION_USAGE_TOTALS,
      ctx.turn,
    );
    await saveStore(ctx.root, store);
  });
}

export async function saveMissingSessionUsageTotals(ctx: {
  root: string;
  entries: ReadonlyMap<string, SessionUsageTotals>;
}): Promise<boolean> {
  if (ctx.entries.size === 0) return false;
  return withStoreLock(ctx.root, async () => {
    const store = await loadStore(ctx.root);
    let updated = false;
    for (const session of sessionsOf(store)) {
      if (session.usageTotals !== undefined) continue;
      const computed = ctx.entries.get(session.id);
      if (!computed) continue;
      session.usageTotals = computed;
      updated = true;
    }
    if (updated) await saveStore(ctx.root, store);
    return updated;
  });
}
