import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { providers } from './providers.js';
import { removeSessionsOfProjects } from './sessions.js';
import { loadStore, saveStore, withStoreLock } from './store.js';
import type { Account, ProviderId, Store } from './types.js';

type AccountErrorCode = 'duplicate-label' | 'not-found' | 'has-projects' | 'unsafe-path';

export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode, message: string) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
  }
}

export function findAccount(store: Store, label: string): Account | undefined {
  return store.accounts.find((account) => account.label === label);
}

export async function addAccount(ctx: {
  root: string;
  provider: ProviderId;
  label: string;
}): Promise<Account> {
  return withStoreLock(ctx.root, async () => {
    const store = await loadStore(ctx.root);
    if (findAccount(store, ctx.label)) {
      throw new AccountError('duplicate-label', `Account label already exists: ${ctx.label}`);
    }
    const id = randomUUID();
    const homeDir = join(ctx.root, 'accounts', id);
    await mkdir(homeDir, { recursive: true, mode: 0o700 });
    await providers[ctx.provider].initHome(homeDir);
    const account: Account = {
      id,
      provider: ctx.provider,
      label: ctx.label,
      homeDir,
      createdAt: new Date().toISOString(),
    };
    store.accounts.push(account);
    await saveStore(ctx.root, store);
    return account;
  });
}

function assertInsideAccountsRoot(root: string, account: Account): void {
  const expected = resolve(root, 'accounts', account.id);
  if (resolve(account.homeDir) !== expected || dirname(expected) !== resolve(root, 'accounts')) {
    throw new AccountError(
      'unsafe-path',
      `Account home is outside accounts root: ${account.label}`,
    );
  }
}

export async function removeAccount(ctx: {
  root: string;
  label: string;
  force: boolean;
}): Promise<void> {
  await withStoreLock(ctx.root, async () => {
    const store = await loadStore(ctx.root);
    const account = findAccount(store, ctx.label);
    if (!account) throw new AccountError('not-found', `Account not found: ${ctx.label}`);
    const bound = store.projects.filter((project) => project.accountId === account.id);
    if (bound.length > 0 && !ctx.force) {
      throw new AccountError('has-projects', `Account has ${bound.length} bound project(s)`);
    }
    assertInsideAccountsRoot(ctx.root, account);
    await rm(account.homeDir, { recursive: true, force: true });
    store.accounts = store.accounts.filter((item) => item.id !== account.id);
    removeSessionsOfProjects(store, new Set(bound.map((project) => project.id)));
    store.projects = store.projects.filter((project) => project.accountId !== account.id);
    await saveStore(ctx.root, store);
  });
}
