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

export type ChatTurn =
  | { mode: 'new'; sessionId: string }
  | { mode: 'resume'; providerSessionId: string }
  | { mode: 'fork'; parentProviderSessionId: string; sessionId: string };

function claudeTurnArgs(prompt: string, turn: ChatTurn): string[] {
  const base = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode',
    'acceptEdits',
  ];
  switch (turn.mode) {
    case 'new':
      return [...base, '--session-id', turn.sessionId];
    case 'resume':
      return [...base, '--resume', turn.providerSessionId];
    case 'fork':
      return [
        ...base,
        '--resume',
        turn.parentProviderSessionId,
        '--fork-session',
        '--session-id',
        turn.sessionId,
      ];
  }
}

function geminiTurnArgs(prompt: string, turn: ChatTurn): string[] {
  const base = ['-p', prompt, '-o', 'stream-json', '--approval-mode', 'auto_edit', '--skip-trust'];
  if (turn.mode === 'resume') return [...base, '--resume', turn.providerSessionId];
  return [...base, '--session-id', turn.sessionId];
}

function codexTurnArgs(prompt: string, turn: ChatTurn): string[] {
  const flags = [
    '--json',
    '--sandbox',
    'workspace-write',
    '--skip-git-repo-check',
    ...(prompt.startsWith('-') ? ['--'] : []),
    prompt,
  ];
  if (turn.mode === 'resume') return ['exec', 'resume', turn.providerSessionId, ...flags];
  return ['exec', ...flags];
}

export function buildChatTurn(ctx: {
  account: Account;
  cwd: string;
  prompt: string;
  turn: ChatTurn;
  baseEnv: NodeJS.ProcessEnv;
}): LaunchSpec {
  const { provider } = ctx.account;
  const args =
    provider === 'claude'
      ? claudeTurnArgs(ctx.prompt, ctx.turn)
      : provider === 'gemini'
        ? geminiTurnArgs(ctx.prompt, ctx.turn)
        : codexTurnArgs(ctx.prompt, ctx.turn);
  return buildLaunch({ account: ctx.account, cwd: ctx.cwd, args, baseEnv: ctx.baseEnv });
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
