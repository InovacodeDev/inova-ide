import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccountError, addAccount, findAccount, removeAccount } from './accounts.js';
import { loadStore, saveStore } from './store.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inova-accounts-'));
});

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe('accounts', () => {
  it('addAccount creates home with mode 0700 and persists', async () => {
    const account = await addAccount({ root, provider: 'codex', label: 'work' });
    expect(account.homeDir).toBe(join(root, 'accounts', account.id));
    expect((await stat(account.homeDir)).mode & 0o777).toBe(0o700);
    expect(await exists(join(account.homeDir, 'config.toml'))).toBe(true);
    const store = await loadStore(root);
    expect(findAccount(store, 'work')).toEqual(account);
  });

  it('addAccount rejects duplicate label across providers', async () => {
    await addAccount({ root, provider: 'claude', label: 'work' });
    const err = await addAccount({ root, provider: 'gemini', label: 'work' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AccountError);
    expect((err as AccountError).code).toBe('duplicate-label');
  });

  it('removeAccount refuses when projects are bound, force removes both', async () => {
    const account = await addAccount({ root, provider: 'claude', label: 'work' });
    const store = await loadStore(root);
    store.projects.push({ id: 'p1', path: '/repo', accountId: account.id });
    await saveStore(root, store);

    const err = await removeAccount({ root, label: 'work', force: false }).catch((e: unknown) => e);
    expect((err as AccountError).code).toBe('has-projects');

    await removeAccount({ root, label: 'work', force: true });
    expect(await loadStore(root)).toEqual({ version: 1, accounts: [], projects: [] });
    expect(await exists(account.homeDir)).toBe(false);
  });

  it('removeAccount throws not-found for unknown label', async () => {
    const err = await removeAccount({ root, label: 'nope', force: false }).catch((e: unknown) => e);
    expect((err as AccountError).code).toBe('not-found');
  });

  it('removeAccount refuses homeDir outside accounts root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'inova-outside-'));
    await writeFile(join(outside, 'keep'), 'x');
    await saveStore(root, {
      version: 1,
      accounts: [
        { id: 'a1', provider: 'claude', label: 'bad', homeDir: outside, createdAt: '2026-01-01' },
      ],
      projects: [],
    });
    const err = await removeAccount({ root, label: 'bad', force: true }).catch((e: unknown) => e);
    expect((err as AccountError).code).toBe('unsafe-path');
    expect(await exists(join(outside, 'keep'))).toBe(true);
    expect(findAccount(await loadStore(root), 'bad')).toBeDefined();
  });

  it.each([
    ['the accounts root', (r: string) => join(r, 'accounts')],
    ['a traversal path', (r: string) => join(r, 'accounts', '..', 'x')],
    ['another account home', (r: string) => join(r, 'accounts', 'other')],
    ['a nested path', (r: string) => join(r, 'accounts', 'a1', 'sub')],
  ])('removeAccount refuses homeDir that is %s', async (_name, pick) => {
    const other = join(root, 'accounts', 'other');
    await mkdir(join(root, 'accounts', 'a1', 'sub'), { recursive: true });
    await mkdir(other, { recursive: true });
    await writeFile(join(other, 'keep'), 'x');
    await mkdir(join(root, 'x'), { recursive: true });
    const before = {
      version: 1 as const,
      accounts: [
        {
          id: 'a1',
          provider: 'claude' as const,
          label: 'bad',
          homeDir: pick(root),
          createdAt: 't',
        },
        { id: 'other', provider: 'claude' as const, label: 'o', homeDir: other, createdAt: 't' },
      ],
      projects: [{ id: 'p1', path: '/repo', accountId: 'a1' }],
    };
    await saveStore(root, before);
    const err = await removeAccount({ root, label: 'bad', force: true }).catch((e: unknown) => e);
    expect((err as AccountError).code).toBe('unsafe-path');
    expect(await exists(join(other, 'keep'))).toBe(true);
    expect(await exists(join(root, 'accounts', 'a1', 'sub'))).toBe(true);
    expect(await exists(join(root, 'x'))).toBe(true);
    expect(await loadStore(root)).toEqual(before);
  });

  it('removeAccount deletes only the account home', async () => {
    const account = await addAccount({ root, provider: 'claude', label: 'work' });
    const sibling = join(root, 'accounts', 'outro');
    await mkdir(sibling, { recursive: true });
    await removeAccount({ root, label: 'work', force: false });
    expect(await exists(account.homeDir)).toBe(false);
    expect(await exists(sibling)).toBe(true);
  });
});
