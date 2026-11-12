import { randomUUID } from 'node:crypto';
import { loadStore, saveStore } from './store.js';
import type { Session, Store, Workspace } from './types.js';

type SessionErrorCode =
  'project-not-found' | 'parent-not-found' | 'not-found' | 'invalid-title' | 'invalid-workspace';

const MAX_TITLE_LENGTH = 200;
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

export async function createSession(ctx: {
  root: string;
  projectId: string;
  parentId?: string | null;
  title?: string;
  now?: () => Date;
}): Promise<Session> {
  const store = await loadStore(ctx.root);
  if (!store.projects.some((project) => project.id === ctx.projectId)) {
    throw new SessionError('project-not-found', `Project not found: ${ctx.projectId}`);
  }
  const parentId = ctx.parentId ?? null;
  if (parentId !== null) {
    const parent = sessionsOf(store).find((item) => item.id === parentId);
    if (parent?.projectId !== ctx.projectId) {
      throw new SessionError('parent-not-found', `Parent session not found: ${parentId}`);
    }
  }
  const timestamp = (ctx.now?.() ?? new Date()).toISOString();
  const session: Session = {
    id: randomUUID(),
    projectId: ctx.projectId,
    parentId,
    title: ctx.title ?? (parentId === null ? 'Nova sessão' : 'Subsessão'),
    providerSessionId: null,
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
  patch: Partial<Pick<Session, 'title' | 'providerSessionId'>> & { archived?: boolean };
  now?: () => Date;
}): Promise<Session> {
  const store = await loadStore(ctx.root);
  const session = requireSession(store, ctx.sessionId);
  const { title, providerSessionId, archived } = ctx.patch;
  const timestamp = (ctx.now?.() ?? new Date()).toISOString();
  if (title !== undefined) session.title = normalizeTitle(title);
  if (providerSessionId !== undefined) session.providerSessionId = providerSessionId;
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
