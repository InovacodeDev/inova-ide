import { providers } from './providers.js';
import type { Account, EffortLevel } from './types.js';

export interface LaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface TurnModelOptions {
  model?: string | null;
  effort?: EffortLevel | null;
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

function claudeTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  const base = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode',
    'acceptEdits',
    ...(options.model ? ['--model', options.model] : []),
    ...(options.effort ? ['--effort', options.effort] : []),
  ];
  const tail = ['--', prompt];
  switch (turn.mode) {
    case 'new':
      return [...base, '--session-id', turn.sessionId, ...tail];
    case 'resume':
      return [...base, '--resume', turn.providerSessionId, ...tail];
    case 'fork':
      return [
        ...base,
        '--resume',
        turn.parentProviderSessionId,
        '--fork-session',
        '--session-id',
        turn.sessionId,
        ...tail,
      ];
  }
}

function geminiTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  const base = [
    `--prompt=${prompt}`,
    '--output-format',
    'stream-json',
    '--mode',
    'accept-edits',
    '--dangerously-skip-permissions',
    ...(options.model ? ['--model', options.model] : []),
    ...(options.effort ? ['--effort', options.effort] : []),
  ];
  if (turn.mode === 'resume') return [...base, '--conversation', turn.providerSessionId];
  return base;
}

function codexTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  const flags = [
    '--json',
    '--sandbox',
    'workspace-write',
    '--skip-git-repo-check',
    ...(options.model ? ['--model', options.model] : []),
    ...(options.effort ? ['-c', `model_reasoning_effort="${options.effort}"`] : []),
    ...(prompt.startsWith('-') ? ['--'] : []),
    prompt,
  ];
  if (turn.mode === 'resume') return ['exec', 'resume', turn.providerSessionId, ...flags];
  return ['exec', ...flags];
}

function deepseekTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  const sessionId = turn.mode === 'resume' ? turn.providerSessionId : turn.sessionId;
  return [
    '--profile',
    'headless',
    '--jsonl',
    '--mode',
    'workspace-write',
    '--session-id',
    sessionId,
    ...(options.model ? ['--model', options.model] : []),
    prompt,
  ];
}

function kimiTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  return [
    '--print',
    '--prompt',
    prompt,
    '--output-format',
    'stream-json',
    '--yolo',
    ...(options.model ? ['-m', options.model] : []),
    ...(turn.mode === 'resume' ? ['-S', turn.providerSessionId] : []),
  ];
}

function grokTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  return [
    '-p',
    prompt,
    '--output-format',
    'streaming-json',
    '--always-approve',
    ...(options.model ? ['--model', options.model] : []),
    ...(turn.mode === 'resume' ? ['-r', turn.providerSessionId] : []),
  ];
}

function qwenTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  return [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--approval-mode',
    'yolo',
    ...(options.model ? ['--model', options.model] : []),
    ...(turn.mode === 'resume' ? ['--resume', turn.providerSessionId] : []),
  ];
}

function opencodeTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  return [
    'run',
    '--format',
    'json',
    ...(options.model ? ['-m', options.model] : []),
    ...(turn.mode === 'resume' ? ['-s', turn.providerSessionId] : []),
    prompt,
  ];
}

function argsForProvider(
  provider: Account['provider'],
  prompt: string,
  turn: ChatTurn,
  options: TurnModelOptions,
): string[] {
  switch (provider) {
    case 'claude':
      return claudeTurnArgs(prompt, turn, options);
    case 'gemini':
      return geminiTurnArgs(prompt, turn, options);
    case 'codex':
      return codexTurnArgs(prompt, turn, options);
    case 'deepseek':
      return deepseekTurnArgs(prompt, turn, options);
    case 'kimi':
      return kimiTurnArgs(prompt, turn, options);
    case 'grok':
      return grokTurnArgs(prompt, turn, options);
    case 'qwen':
      return qwenTurnArgs(prompt, turn, options);
    case 'opencode':
      return opencodeTurnArgs(prompt, turn, options);
  }
}

export function buildChatTurn(ctx: {
  account: Account;
  cwd: string;
  prompt: string;
  turn: ChatTurn;
  baseEnv: NodeJS.ProcessEnv;
  model?: string | null;
  effort?: EffortLevel | null;
}): LaunchSpec {
  const options: TurnModelOptions = { model: ctx.model, effort: ctx.effort };
  const args = argsForProvider(ctx.account.provider, ctx.prompt, ctx.turn, options);
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
