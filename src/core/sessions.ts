import { randomUUID } from 'node:crypto';
import { isEffortLevel } from './models.js';
import { isExecutionMode, isModeSupported } from './modes.js';
import { loadStore, saveStore } from './store.js';
import type { ExecutionMode, ProviderId, Session, Store, Workspace } from './types.js';

type SessionErrorCode =
  | 'project-not-found'
  | 'parent-not-found'
  | 'not-found'
  | 'invalid-title'
  | 'invalid-model'
  | 'invalid-effort'
  | 'invalid-mode'
  | 'invalid-workspace';

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
  const store = await loadStore(ctx.root);
  store.workspace = sanitizeWorkspace(store, ctx.workspace);
  await saveStore(ctx.root, store);
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

function providerForProject(store: Store, projectId: string): ProviderId | null {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) return null;
  const account = store.accounts.find((item) => item.id === project.accountId);
  return account?.provider ?? null;
}

export async function createSession(ctx: {
  root: string;
  projectId: string;
  parentId?: string | null;
  title?: string;
  mode?: ExecutionMode | null;
  now?: () => Date;
}): Promise<Session> {
  const store = await loadStore(ctx.root);
  const project = store.projects.find((item) => item.id === ctx.projectId);
  if (!project) {
    throw new SessionError('project-not-found', `Project not found: ${ctx.projectId}`);
  }
  const parentId = ctx.parentId ?? null;
  if (parentId !== null) {
    const parent = sessionsOf(store).find((item) => item.id === parentId);
    if (parent?.projectId !== ctx.projectId) {
      throw new SessionError('parent-not-found', `Parent session not found: ${parentId}`);
    }
  }
  const provider = providerForProject(store, ctx.projectId);
  const inheritedMode =
    ctx.mode !== undefined ? ctx.mode : provider ? (store.defaultModes?.[provider] ?? null) : null;
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
    providerSessionId: null,
    model: null,
    effort: null,
    mode: inheritedMode,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  };
  sessionsOf(store).push(session);
  await saveStore(ctx.root, store);
  return session;
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
  patch: Partial<Pick<Session, 'title' | 'providerSessionId' | 'model' | 'effort' | 'mode'>> & {
    archived?: boolean;
  };
  now?: () => Date;
}): Promise<Session> {
  const store = await loadStore(ctx.root);
  const session = requireSession(store, ctx.sessionId);
  const { title, providerSessionId, model, effort, mode, archived } = ctx.patch;
  const timestamp = (ctx.now?.() ?? new Date()).toISOString();
  if (title !== undefined) session.title = normalizeTitle(title);
  if (providerSessionId !== undefined) session.providerSessionId = providerSessionId;
  if (model !== undefined) session.model = normalizeModel(model);
  if (effort !== undefined) {
    if (effort !== null && !isEffortLevel(effort)) {
      throw new SessionError('invalid-effort', `Invalid effort: ${String(effort)}`);
    }
    session.effort = effort;
  }
  if (mode !== undefined) {
    const provider = providerForProject(store, session.projectId);
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
}

export async function deleteSession(ctx: { root: string; sessionId: string }): Promise<string[]> {
  const store = await loadStore(ctx.root);
  requireSession(store, ctx.sessionId);
  const removed = descendantIds(store, ctx.sessionId);
  store.sessions = sessionsOf(store).filter((session) => !removed.has(session.id));
  dropFromWorkspace(store, removed);
  await saveStore(ctx.root, store);
  return [...removed];
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
  const store = await loadStore(ctx.root);
  store.defaultModes = { ...(store.defaultModes ?? {}), [ctx.provider]: ctx.mode };
  await saveStore(ctx.root, store);
  return { ...store.defaultModes };
}
