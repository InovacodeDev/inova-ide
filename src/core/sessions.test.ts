import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
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
});
