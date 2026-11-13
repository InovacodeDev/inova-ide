import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSession,
  deleteSession,
  getSession,
  getWorkspace,
  listSessions,
  removeSessionsOfProjects,
  saveWorkspace,
  SessionError,
  updateSession,
} from './sessions.js';
import { loadStore, saveStore } from './store.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inova-sessions-'));
  await saveStore(root, {
    version: 1,
    accounts: [],
    projects: [
      { id: 'p1', path: '/one', accountId: 'a' },
      { id: 'p2', path: '/two', accountId: 'a' },
    ],
  });
});

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const err = await promise.catch((e: unknown) => e);
  return err instanceof SessionError ? err.code : undefined;
}

describe('sessions', () => {
  it('createSession persists with defaults', async () => {
    const now = (): Date => new Date('2026-01-01T00:00:00.000Z');
    const session = await createSession({ root, projectId: 'p1', now });
    expect(session).toMatchObject({
      projectId: 'p1',
      parentId: null,
      title: 'Nova sessão',
      providerSessionId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect((await loadStore(root)).sessions).toEqual([session]);
  });

  it('createSession rejects unknown project', async () => {
    expect(await codeOf(createSession({ root, projectId: 'nope' }))).toBe('project-not-found');
  });

  it('createSession creates a child with default title and validates the parent', async () => {
    const parent = await createSession({ root, projectId: 'p1' });
    const child = await createSession({ root, projectId: 'p1', parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
    expect(child.title).toBe('Subsessão');
    expect(await codeOf(createSession({ root, projectId: 'p1', parentId: 'x' }))).toBe(
      'parent-not-found',
    );
    expect(await codeOf(createSession({ root, projectId: 'p2', parentId: parent.id }))).toBe(
      'parent-not-found',
    );
  });

  it('listSessions returns only sessions of the project', async () => {
    const a = await createSession({ root, projectId: 'p1' });
    await createSession({ root, projectId: 'p2' });
    expect(await listSessions({ root, projectId: 'p1' })).toEqual([a]);
  });

  it('getSession returns the session or throws not-found', async () => {
    const a = await createSession({ root, projectId: 'p1' });
    expect(await getSession({ root, sessionId: a.id })).toEqual(a);
    expect(await codeOf(getSession({ root, sessionId: 'nope' }))).toBe('not-found');
  });

  it('updateSession patches fields and bumps updatedAt', async () => {
    const a = await createSession({
      root,
      projectId: 'p1',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const updated = await updateSession({
      root,
      sessionId: a.id,
      patch: { title: '  Novo  ', providerSessionId: 'prov-1' },
      now: () => new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(updated.title).toBe('Novo');
    expect(updated.providerSessionId).toBe('prov-1');
    expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(updated.updatedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(await getSession({ root, sessionId: a.id })).toEqual(updated);
  });

  it('updateSession stores and clears model and effort and rejects invalid values', async () => {
    const a = await createSession({ root, projectId: 'p1' });
    expect(a.model).toBeNull();
    expect(a.effort).toBeNull();

    const updated = await updateSession({
      root,
      sessionId: a.id,
      patch: { model: '  opus  ', effort: 'high' },
    });
    expect(updated.model).toBe('opus');
    expect(updated.effort).toBe('high');

    const cleared = await updateSession({
      root,
      sessionId: a.id,
      patch: { model: null, effort: null },
    });
    expect(cleared.model).toBeNull();
    expect(cleared.effort).toBeNull();

    expect(await codeOf(updateSession({ root, sessionId: a.id, patch: { model: '   ' } }))).toBe(
      'invalid-model',
    );
    expect(
      await codeOf(updateSession({ root, sessionId: a.id, patch: { effort: 'invalid' as never } })),
    ).toBe('invalid-effort');
  });

  it('updateSession rejects invalid titles and unknown sessions', async () => {
    const a = await createSession({ root, projectId: 'p1' });
    expect(await codeOf(updateSession({ root, sessionId: a.id, patch: { title: '   ' } }))).toBe(
      'invalid-title',
    );
    expect(
      await codeOf(updateSession({ root, sessionId: a.id, patch: { title: 'x'.repeat(201) } })),
    ).toBe('invalid-title');
    expect(await codeOf(updateSession({ root, sessionId: 'nope', patch: { title: 'x' } }))).toBe(
      'not-found',
    );
  });

  it('deleteSession removes the session and all descendants', async () => {
    const a = await createSession({ root, projectId: 'p1' });
    const b = await createSession({ root, projectId: 'p1', parentId: a.id });
    const c = await createSession({ root, projectId: 'p1', parentId: b.id });
    const other = await createSession({ root, projectId: 'p1' });
    const removed = await deleteSession({ root, sessionId: a.id });
    expect(new Set(removed)).toEqual(new Set([a.id, b.id, c.id]));
    expect(await listSessions({ root, projectId: 'p1' })).toEqual([other]);
    expect(await codeOf(deleteSession({ root, sessionId: a.id }))).toBe('not-found');
  });

  it('createSession starts with archivedAt null', async () => {
    expect((await createSession({ root, projectId: 'p1' })).archivedAt).toBeNull();
  });

  async function seedTree() {
    const a = await createSession({ root, projectId: 'p1' });
    const b = await createSession({ root, projectId: 'p1', parentId: a.id });
    const c = await createSession({ root, projectId: 'p1', parentId: b.id });
    const other = await createSession({ root, projectId: 'p1' });
    return { a, b, c, other };
  }

  it('updateSession archives the session and descendants, and unarchives them', async () => {
    const { a, b, c, other } = await seedTree();
    const now = (): Date => new Date('2026-03-01T00:00:00.000Z');
    const archived = await updateSession({ root, sessionId: a.id, patch: { archived: true }, now });
    expect(archived.id).toBe(a.id);
    expect(archived.archivedAt).toBe('2026-03-01T00:00:00.000Z');
    const stored = await listSessions({ root, projectId: 'p1' });
    const byId = new Map(stored.map((item) => [item.id, item.archivedAt]));
    expect(byId.get(b.id)).toBe('2026-03-01T00:00:00.000Z');
    expect(byId.get(c.id)).toBe('2026-03-01T00:00:00.000Z');
    expect(byId.get(other.id)).toBeNull();
    const restored = await updateSession({ root, sessionId: a.id, patch: { archived: false } });
    expect(restored.archivedAt).toBeNull();
    const after = await listSessions({ root, projectId: 'p1' });
    expect(after.every((item) => item.archivedAt === null)).toBe(true);
  });

  it('archiving removes the subtree from the workspace', async () => {
    const { a, b, other } = await seedTree();
    await saveWorkspace({
      root,
      workspace: { openSessionIds: [a.id, b.id, other.id], activeSessionId: b.id },
    });
    await updateSession({ root, sessionId: a.id, patch: { archived: true } });
    expect((await loadStore(root)).workspace).toEqual({
      openSessionIds: [other.id],
      activeSessionId: null,
    });
  });

  it('deleteSession removes ids from the workspace', async () => {
    const { a, b, other } = await seedTree();
    await saveWorkspace({
      root,
      workspace: { openSessionIds: [a.id, b.id, other.id], activeSessionId: other.id },
    });
    await deleteSession({ root, sessionId: a.id });
    expect(await getWorkspace(root)).toEqual({
      openSessionIds: [other.id],
      activeSessionId: other.id,
    });
    await deleteSession({ root, sessionId: other.id });
    expect((await loadStore(root)).workspace).toEqual({
      openSessionIds: [],
      activeSessionId: null,
    });
  });

  it('removeSessionsOfProjects removes ids from the workspace', async () => {
    const a = await createSession({ root, projectId: 'p1' });
    const b = await createSession({ root, projectId: 'p2' });
    await saveWorkspace({
      root,
      workspace: { openSessionIds: [a.id, b.id], activeSessionId: a.id },
    });
    const store = await loadStore(root);
    removeSessionsOfProjects(store, new Set(['p1']));
    expect(store.workspace).toEqual({ openSessionIds: [b.id], activeSessionId: null });
  });

  it('getWorkspace returns an empty workspace when none is saved', async () => {
    expect(await getWorkspace(root)).toEqual({ openSessionIds: [], activeSessionId: null });
  });

  it('getWorkspace filters unknown and archived ids and an inactive active id', async () => {
    const a = await createSession({ root, projectId: 'p1' });
    const b = await createSession({ root, projectId: 'p1' });
    const store = await loadStore(root);
    store.workspace = { openSessionIds: [a.id, 'ghost', b.id], activeSessionId: 'ghost' };
    const [first] = store.sessions ?? [];
    if (first) first.archivedAt = '2026-01-01T00:00:00.000Z';
    await saveStore(root, store);
    expect(await getWorkspace(root)).toEqual({ openSessionIds: [b.id], activeSessionId: null });
  });

  it('saveWorkspace drops unknown and archived ids, de-duplicates and keeps the active id', async () => {
    const a = await createSession({ root, projectId: 'p1' });
    const b = await createSession({ root, projectId: 'p1' });
    const c = await createSession({ root, projectId: 'p1' });
    await updateSession({ root, sessionId: c.id, patch: { archived: true } });
    await saveWorkspace({
      root,
      workspace: { openSessionIds: [b.id, 'ghost', a.id, b.id, c.id], activeSessionId: a.id },
    });
    expect(await getWorkspace(root)).toEqual({
      openSessionIds: [b.id, a.id],
      activeSessionId: a.id,
    });
    await saveWorkspace({
      root,
      workspace: { openSessionIds: [a.id], activeSessionId: b.id },
    });
    expect(await getWorkspace(root)).toEqual({ openSessionIds: [a.id], activeSessionId: null });
  });

  it('saveWorkspace caps the open list at 50 and rejects unsafe ids', async () => {
    const created = [];
    for (let index = 0; index < 52; index += 1) {
      created.push(await createSession({ root, projectId: 'p1' }));
    }
    const ids = created.map((item) => item.id);
    await saveWorkspace({ root, workspace: { openSessionIds: ids, activeSessionId: null } });
    expect((await getWorkspace(root)).openSessionIds).toEqual(ids.slice(0, 50));
    expect(
      await codeOf(
        saveWorkspace({ root, workspace: { openSessionIds: ['a/b'], activeSessionId: null } }),
      ),
    ).toBe('invalid-workspace');
  });

  it('stores and updates session mode and provider default modes', async () => {
    const store = await loadStore(root);
    store.accounts.push({
      id: 'a1',
      provider: 'claude',
      label: 'main',
      homeDir: '/h/claude',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    store.projects.push({ id: 'p-claude', path: '/tmp/proj', accountId: 'a1' });
    store.defaultModes = { claude: 'plan' };
    await saveStore(root, store);

    const created = await createSession({ root, projectId: 'p-claude' });
    expect(created.mode).toBe('plan');

    const updated = await updateSession({
      root,
      sessionId: created.id,
      patch: { mode: 'auto' },
    });
    expect(updated.mode).toBe('auto');

    expect(
      await codeOf(updateSession({ root, sessionId: created.id, patch: { mode: 'read-only' } })),
    ).toBe('invalid-mode');
  });
});
