import { resolve } from 'node:path';
import { buildLaunch } from './core/launch.js';
import { bindProject, realPathOf, resolveProject, unbindProject } from './core/projects.js';
import { providers } from './core/providers.js';
import { loadStore } from './core/store.js';
import { launch, need, root } from './cli-context.js';
import type { Context } from './cli-context.js';

export async function projectBind(ctx: Context, args: string[]): Promise<number> {
  const accountLabel = need(args[0]);
  await bindProject({ root: root(ctx), path: resolve(ctx.cwd, args[1] ?? '.'), accountLabel });
  return 0;
}

export async function projectUnbind(ctx: Context, args: string[]): Promise<number> {
  await unbindProject({ root: root(ctx), path: args[0] ?? ctx.cwd });
  return 0;
}

export async function projectList(ctx: Context): Promise<number> {
  const store = await loadStore(root(ctx));
  for (const project of store.projects) {
    const account = store.accounts.find((item) => item.id === project.accountId);
    ctx.io.out(`${project.path}  ${account?.label ?? '?'}`);
  }
  return 0;
}

export async function runProject(ctx: Context, args: string[]): Promise<number> {
  const cwd = await realPathOf(ctx.cwd);
  const store = await loadStore(root(ctx));
  const project = resolveProject(store, cwd);
  const account = store.accounts.find((item) => item.id === project?.accountId);
  if (!account) {
    ctx.io.err(`Nenhum projeto vinculado a ${cwd}. Rode: inova project bind <label>`);
    return 2;
  }
  await providers[account.provider].prepareLaunch(account.homeDir);
  return launch(ctx, buildLaunch({ account, cwd: ctx.cwd, args, baseEnv: ctx.env }));
}
