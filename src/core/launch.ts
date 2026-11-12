import { providers } from './providers.js';
import type { Account } from './types.js';

export interface LaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

function isolatedEnv(account: Account, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const adapter = providers[account.provider];
  const env = { ...baseEnv };
  for (const name of adapter.strippedEnvVars) delete env[name];
  env[adapter.homeEnvVar] = account.homeDir;
  return env;
}

export function buildLaunch(ctx: {
  account: Account;
  cwd: string;
  args: readonly string[];
  baseEnv: NodeJS.ProcessEnv;
}): LaunchSpec {
  return {
    command: providers[ctx.account.provider].binary,
    args: [...ctx.args],
    cwd: ctx.cwd,
    env: isolatedEnv(ctx.account, ctx.baseEnv),
  };
}

export function buildLogin(ctx: { account: Account; baseEnv: NodeJS.ProcessEnv }): LaunchSpec {
  const adapter = providers[ctx.account.provider];
  return {
    command: adapter.binary,
    args: [...adapter.loginArgs],
    cwd: ctx.account.homeDir,
    env: isolatedEnv(ctx.account, ctx.baseEnv),
  };
}
