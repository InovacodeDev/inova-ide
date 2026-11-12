import { randomUUID } from 'node:crypto';
import { loadStore, saveStore } from './store.js';
import type { Session, Store } from './types.js';

type SessionErrorCode = 'project-not-found' | 'parent-not-found' | 'not-found' | 'invalid-title';

const MAX_TITLE_LENGTH = 200;

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
  patch: Partial<Pick<Session, 'title' | 'providerSessionId'>>;
  now?: () => Date;
}): Promise<Session> {
  const store = await loadStore(ctx.root);
  const session = requireSession(store, ctx.sessionId);
  const { title, providerSessionId } = ctx.patch;
  if (title !== undefined) session.title = normalizeTitle(title);
  if (providerSessionId !== undefined) session.providerSessionId = providerSessionId;
  session.updatedAt = (ctx.now?.() ?? new Date()).toISOString();
  await saveStore(ctx.root, store);
  return session;
}

export async function deleteSession(ctx: { root: string; sessionId: string }): Promise<string[]> {
  const store = await loadStore(ctx.root);
  requireSession(store, ctx.sessionId);
  const sessions = sessionsOf(store);
  const removed = new Set([ctx.sessionId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const session of sessions) {
      if (session.parentId !== null && removed.has(session.parentId) && !removed.has(session.id)) {
        removed.add(session.id);
        grew = true;
      }
    }
  }
  store.sessions = sessions.filter((session) => !removed.has(session.id));
  await saveStore(ctx.root, store);
  return [...removed];
}

export function removeSessionsOfProjects(store: Store, projectIds: ReadonlySet<string>): void {
  if (!store.sessions) return;
  store.sessions = store.sessions.filter((session) => !projectIds.has(session.projectId));
}
