import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccountError, addAccount } from './accounts.js';
import { bindProject, PathNotFoundError, resolveProject, unbindProject } from './projects.js';
import { createSession } from './sessions.js';
import { loadStore } from './store.js';
import type { Store } from './types.js';

let root: string;
let workDir: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'inova-projects-')));
  workDir = join(root, 'work');
  await mkdir(workDir);
});

function storeWith(paths: string[]): Store {
  return {
    version: 1,
    accounts: [],
    projects: paths.map((path, index) => ({ id: `p${index}`, path, accountId: 'a' })),
  };
}

describe('resolveProject', () => {
  it('picks longest matching prefix', () => {
    const store = storeWith(['/a', '/a/b']);
    expect(resolveProject(store, '/a/b/c')?.path).toBe('/a/b');
  });

  it('matches the exact path', () => {
    expect(resolveProject(storeWith(['/a/b']), '/a/b')?.path).toBe('/a/b');
  });

  it('does not match sibling prefix', () => {
    expect(resolveProject(storeWith(['/a/b']), '/a/bc')).toBeUndefined();
  });
});

describe('bindProject', () => {
  it('stores the realpath and the account id', async () => {
    const account = await addAccount({ root, provider: 'claude', label: 'work' });
    const project = await bindProject({ root, path: workDir, accountLabel: 'work' });
    expect(project.path).toBe(workDir);
    expect(project.accountId).toBe(account.id);
    expect((await loadStore(root)).projects).toEqual([project]);
  });

  it('rebinding same path replaces account', async () => {
    await addAccount({ root, provider: 'claude', label: 'one' });
    const two = await addAccount({ root, provider: 'codex', label: 'two' });
    const first = await bindProject({ root, path: workDir, accountLabel: 'one' });
    const second = await bindProject({ root, path: workDir, accountLabel: 'two' });
    const store = await loadStore(root);
    expect(store.projects.length).toBe(1);
    expect(second.id).toBe(first.id);
    expect(store.projects[0]?.accountId).toBe(two.id);
  });

  it('rejects unknown account label', async () => {
    const err = await bindProject({ root, path: workDir, accountLabel: 'nope' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AccountError);
    expect((err as AccountError).code).toBe('not-found');
  });

  it('rejects a path that does not exist with PathNotFoundError', async () => {
    await addAccount({ root, provider: 'claude', label: 'work' });
    const missing = join(root, 'missing');
    const err = await bindProject({ root, path: missing, accountLabel: 'work' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PathNotFoundError);
    expect((err as PathNotFoundError).message).toBe(`Caminho não encontrado: ${missing}`);
  });
});

describe('unbindProject', () => {
  it('removes the binding and is a no-op when unbound', async () => {
    await addAccount({ root, provider: 'claude', label: 'work' });
    await bindProject({ root, path: workDir, accountLabel: 'work' });
    await unbindProject({ root, path: workDir });
    expect((await loadStore(root)).projects).toEqual([]);
    await expect(unbindProject({ root, path: workDir })).resolves.toBeUndefined();
  });

  it('drops only the sessions of the unbound project', async () => {
    await addAccount({ root, provider: 'claude', label: 'work' });
    const project = await bindProject({ root, path: workDir, accountLabel: 'work' });
    const otherDir = join(root, 'other');
    await mkdir(otherDir);
    const other = await bindProject({ root, path: otherDir, accountLabel: 'work' });
    const gone = await createSession({ root, projectId: project.id });
    const kept = await createSession({ root, projectId: other.id });
    await unbindProject({ root, path: workDir });
    expect((await loadStore(root)).sessions).toEqual([kept]);
    expect(gone.projectId).toBe(project.id);
  });

  it('unbinds a project whose folder no longer exists', async () => {
    await addAccount({ root, provider: 'claude', label: 'work' });
    await bindProject({ root, path: workDir, accountLabel: 'work' });
    await rm(workDir, { recursive: true });
    await unbindProject({ root, path: workDir });
    expect((await loadStore(root)).projects).toEqual([]);
  });
});
