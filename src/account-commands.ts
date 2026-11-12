import { addAccount, removeAccount } from './core/accounts.js';
import { buildLaunch, buildLogin } from './core/launch.js';
import { isProviderId, providers } from './core/providers.js';
import { loadStore } from './core/store.js';
import { launch, need, requireAccount, root } from './cli-context.js';
import type { Context } from './cli-context.js';

export async function accountAdd(ctx: Context, args: string[]): Promise<number> {
  const provider = need(args[0]);
  const label = need(args[1]);
  if (!isProviderId(provider)) {
    ctx.io.err(`Provedor inválido: ${provider}. Use: ${Object.keys(providers).join(', ')}`);
    return 1;
  }
  await addAccount({ root: root(ctx), provider, label });
  ctx.io.out(`Rode: inova account login ${label}`);
  return 0;
}

export async function accountLogin(ctx: Context, args: string[]): Promise<number> {
  const account = await requireAccount(ctx, need(args[0]));
  if (account.provider === 'gemini') {
    ctx.io.out('No gemini, escolha "Login with Google" e saia com /quit.');
  }
  return launch(ctx, buildLogin({ account, baseEnv: ctx.env }));
}

export async function accountList(ctx: Context): Promise<number> {
  const store = await loadStore(root(ctx));
  for (const account of store.accounts) {
    const { env } = buildLaunch({ account, cwd: account.homeDir, args: [], baseEnv: ctx.env });
    const status = await providers[account.provider].checkStatus({
      homeDir: account.homeDir,
      env,
      runner: ctx.io.runner,
    });
    ctx.io.out(`${account.label}  ${account.provider}  ${status}`);
  }
  return 0;
}

export async function accountRm(ctx: Context, args: string[]): Promise<number> {
  const force = args.includes('--force');
  const label = need(args.find((arg) => arg !== '--force'));
  await removeAccount({ root: root(ctx), label, force });
  return 0;
}
