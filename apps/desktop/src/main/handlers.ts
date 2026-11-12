import { basename } from 'node:path';
import { addAccount, findAccount, removeAccount } from '@inova/core/accounts';
import { buildLaunch, buildLogin } from '@inova/core/launch';
import type { LaunchSpec } from '@inova/core/launch';
import { bindProject, unbindProject } from '@inova/core/projects';
import { providers } from '@inova/core/providers';
import type { CommandRunner } from '@inova/core/providers';
import { loadStore } from '@inova/core/store';
import type { Account } from '@inova/core/types';
import type { AccountView, OpenedSession, ProjectView, Result } from '../shared/api.js';
import type { SessionManager } from './sessions.js';
import { findBinary } from './shell-env.js';
import {
  fail,
  guarded,
  ok,
  parseBinding,
  parseLoginLaunch,
  parseNewAccount,
  parsePath,
  parseProjectLaunch,
  parseRemoval,
  requireAccount,
  validated,
} from './validation.js';
import type { Size } from './validation.js';

export interface HandlerDeps {
  root: string;
  runner: CommandRunner;
  sessions: SessionManager;
  baseEnv: () => Promise<NodeJS.ProcessEnv>;
  pickFolder: () => Promise<string | null>;
}

function projectView(project: { id: string; path: string }, account: Account): ProjectView {
  return {
    id: project.id,
    path: project.path,
    accountLabel: account.label,
    provider: account.provider,
  };
}

export function createHandlers(deps: HandlerDeps) {
  async function accountView(account: Account): Promise<AccountView> {
    const baseEnv = await deps.baseEnv();
    const { env } = buildLaunch({ account, cwd: account.homeDir, args: [], baseEnv });
    const status = await providers[account.provider].checkStatus({
      homeDir: account.homeDir,
      env,
      runner: deps.runner,
    });
    return { id: account.id, label: account.label, provider: account.provider, status };
  }

  async function startSession(input: {
    account: Account;
    title: string;
    size: Size;
    buildSpec: (baseEnv: NodeJS.ProcessEnv) => Promise<LaunchSpec>;
  }): Promise<Result<OpenedSession>> {
    const adapter = providers[input.account.provider];
    const baseEnv = await deps.baseEnv();
    const file = await findBinary(adapter.binary, baseEnv['PATH'] ?? '');
    if (file === undefined) {
      return fail(`${adapter.binary} não encontrado. Instale: ${adapter.installHint}`);
    }
    const spec = await input.buildSpec(baseEnv);
    const sessionId = deps.sessions.open({
      spec,
      file,
      accountId: input.account.id,
      ...input.size,
    });
    return ok({ sessionId, title: input.title });
  }

  return {
    listAccounts: (): Promise<Result<AccountView[]>> =>
      guarded(async () => {
        const store = await loadStore(deps.root);
        return ok(await Promise.all(store.accounts.map(accountView)));
      }),
    addAccount: (input: unknown): Promise<Result<AccountView>> =>
      validated(input, parseNewAccount, async ({ provider, label }) =>
        ok(await accountView(await addAccount({ root: deps.root, provider, label }))),
      ),
    removeAccount: (input: unknown): Promise<Result<null>> =>
      validated(input, parseRemoval, async ({ label, force }) => {
        const account = findAccount(await loadStore(deps.root), label);
        if (account && deps.sessions.accountsInUse().has(account.id)) {
          return fail('Feche as abas desta conta antes de removê-la.');
        }
        await removeAccount({ root: deps.root, label, force });
        return ok(null);
      }),
    listProjects: (): Promise<Result<ProjectView[]>> =>
      guarded(async () => {
        const store = await loadStore(deps.root);
        return ok(
          store.projects.flatMap((project) => {
            const account = store.accounts.find((item) => item.id === project.accountId);
            return account ? [projectView(project, account)] : [];
          }),
        );
      }),
    pickFolder: (): Promise<string | null> => deps.pickFolder(),
    bindProject: (input: unknown): Promise<Result<ProjectView>> =>
      validated(input, parseBinding, async ({ path, accountLabel }) => {
        const project = await bindProject({ root: deps.root, path, accountLabel });
        const account = requireAccount(await loadStore(deps.root), accountLabel);
        return ok(projectView(project, account));
      }),
    unbindProject: (input: unknown): Promise<Result<null>> =>
      validated(input, parsePath, async ({ path }) => {
        await unbindProject({ root: deps.root, path });
        return ok(null);
      }),
    openProject: (input: unknown): Promise<Result<OpenedSession>> =>
      validated(input, parseProjectLaunch, async ({ projectId, ...size }) => {
        const store = await loadStore(deps.root);
        const project = store.projects.find((item) => item.id === projectId);
        const account = store.accounts.find((item) => item.id === project?.accountId);
        if (!project || !account) return fail('Projeto não encontrado.');
        return startSession({
          account,
          size,
          title: `${basename(project.path)} · ${account.label}`,
          buildSpec: async (baseEnv) => {
            await providers[account.provider].prepareLaunch(account.homeDir);
            return buildLaunch({ account, cwd: project.path, args: [], baseEnv });
          },
        });
      }),
    openLogin: (input: unknown): Promise<Result<OpenedSession>> =>
      validated(input, parseLoginLaunch, async ({ accountLabel, ...size }) => {
        const account = requireAccount(await loadStore(deps.root), accountLabel);
        return startSession({
          account,
          size,
          title: `login · ${account.label}`,
          buildSpec: async (baseEnv) => buildLogin({ account, baseEnv }),
        });
      }),
  };
}
