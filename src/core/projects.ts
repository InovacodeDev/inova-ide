import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { sep } from 'node:path';
import { AccountError, findAccount } from './accounts.js';
import { loadStore, saveStore } from './store.js';
import type { Project, Store } from './types.js';

export async function bindProject(ctx: {
  root: string;
  path: string;
  accountLabel: string;
}): Promise<Project> {
  const path = await realpath(ctx.path);
  const store = await loadStore(ctx.root);
  const account = findAccount(store, ctx.accountLabel);
  if (!account) throw new AccountError('not-found', `Account not found: ${ctx.accountLabel}`);
  const existing = store.projects.find((project) => project.path === path);
  if (existing) {
    existing.accountId = account.id;
    await saveStore(ctx.root, store);
    return existing;
  }
  const project: Project = { id: randomUUID(), path, accountId: account.id };
  store.projects.push(project);
  await saveStore(ctx.root, store);
  return project;
}

export async function unbindProject(ctx: { root: string; path: string }): Promise<void> {
  const path = await realpath(ctx.path);
  const store = await loadStore(ctx.root);
  const remaining = store.projects.filter((project) => project.path !== path);
  if (remaining.length === store.projects.length) return;
  store.projects = remaining;
  await saveStore(ctx.root, store);
}

export function resolveProject(store: Store, cwd: string): Project | undefined {
  let best: Project | undefined;
  for (const project of store.projects) {
    const matches = cwd === project.path || cwd.startsWith(project.path + sep);
    if (matches && (!best || project.path.length > best.path.length)) best = project;
  }
  return best;
}
