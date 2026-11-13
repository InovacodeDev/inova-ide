import { resolveExecutionMode } from './modes.js';
import { providers } from './providers.js';
import type { Account, EffortLevel, ExecutionMode } from './types.js';

export interface LaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface TurnModelOptions {
  model?: string | null;
  effort?: EffortLevel | null;
  executionMode?: ExecutionMode | null;
  extraDirs?: readonly string[] | undefined;
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

function claudeModeArgs(mode: ExecutionMode): string[] {
  switch (mode) {
    case 'auto':
      return ['--permission-mode', 'auto'];
    case 'manual':
      return ['--permission-mode', 'manual', '--permission-prompts', 'none'];
    case 'plan':
      return ['--permission-mode', 'plan'];
    case 'bypass':
      return ['--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions'];
    case 'accept-edits':
    case 'read-only':
      return ['--permission-mode', 'acceptEdits'];
  }
}

function claudeTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  const mode = resolveExecutionMode({ provider: 'claude', sessionMode: options.executionMode });
  const base = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...claudeModeArgs(mode),
    ...(options.extraDirs?.length ? ['--add-dir', ...options.extraDirs] : []),
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

function geminiModeArgs(mode: ExecutionMode): string[] {
  switch (mode) {
    case 'manual':
      return ['--mode', 'accept-edits', '--sandbox'];
    case 'accept-edits':
      return ['--mode', 'accept-edits'];
    case 'auto':
      return ['--mode', 'auto'];
    case 'plan':
      return ['--mode', 'plan'];
    case 'bypass':
    case 'read-only':
      return ['--mode', 'accept-edits', '--dangerously-skip-permissions'];
  }
}

function geminiTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  const mode = resolveExecutionMode({ provider: 'gemini', sessionMode: options.executionMode });
  const base = [
    `--prompt=${prompt}`,
    '--output-format',
    'stream-json',
    ...geminiModeArgs(mode),
    ...(options.model ? ['--model', options.model] : []),
    ...(options.effort ? ['--effort', options.effort] : []),
  ];
  if (turn.mode === 'resume') return [...base, '--conversation', turn.providerSessionId];
  return base;
}

function codexModeArgs(mode: ExecutionMode): string[] {
  switch (mode) {
    case 'read-only':
      return ['--sandbox', 'read-only'];
    case 'auto':
      return ['--sandbox', 'workspace-write', '--approve-for-me'];
    case 'bypass':
      return ['--dangerously-bypass-approvals-and-sandbox'];
    case 'accept-edits':
    case 'manual':
    case 'plan':
      return ['--sandbox', 'workspace-write'];
  }
}

function codexTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  const mode = resolveExecutionMode({ provider: 'codex', sessionMode: options.executionMode });
  const flags = [
    '--json',
    ...codexModeArgs(mode),
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
  const mode = resolveExecutionMode({ provider: 'deepseek', sessionMode: options.executionMode });
  return [
    '--profile',
    'headless',
    '--jsonl',
    '--mode',
    mode === 'read-only' ? 'read-only' : 'workspace-write',
    '--session-id',
    sessionId,
    ...(options.model ? ['--model', options.model] : []),
    prompt,
  ];
}

function kimiModeArgs(mode: ExecutionMode): string[] {
  switch (mode) {
    case 'manual':
      return [];
    case 'bypass':
      return ['--auto'];
    case 'accept-edits':
    case 'auto':
    case 'plan':
    case 'read-only':
      return ['--yolo'];
  }
}

function kimiTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  const mode = resolveExecutionMode({ provider: 'kimi', sessionMode: options.executionMode });
  return [
    '--print',
    '--prompt',
    prompt,
    '--output-format',
    'stream-json',
    ...kimiModeArgs(mode),
    ...(options.model ? ['-m', options.model] : []),
    ...(turn.mode === 'resume' ? ['-S', turn.providerSessionId] : []),
  ];
}

function grokTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  const mode = resolveExecutionMode({ provider: 'grok', sessionMode: options.executionMode });
  return [
    '-p',
    prompt,
    '--output-format',
    'streaming-json',
    ...(mode === 'bypass' ? ['--always-approve'] : []),
    ...(options.model ? ['--model', options.model] : []),
    ...(turn.mode === 'resume' ? ['-r', turn.providerSessionId] : []),
  ];
}

function qwenModeArg(mode: ExecutionMode): string {
  switch (mode) {
    case 'plan':
      return 'plan';
    case 'manual':
      return 'default';
    case 'accept-edits':
      return 'auto-edit';
    case 'bypass':
    case 'auto':
    case 'read-only':
      return 'yolo';
  }
}

function qwenTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  const mode = resolveExecutionMode({ provider: 'qwen', sessionMode: options.executionMode });
  return [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--approval-mode',
    qwenModeArg(mode),
    ...(options.model ? ['--model', options.model] : []),
    ...(turn.mode === 'resume' ? ['--resume', turn.providerSessionId] : []),
  ];
}

function opencodeTurnArgs(prompt: string, turn: ChatTurn, options: TurnModelOptions): string[] {
  const mode = resolveExecutionMode({ provider: 'opencode', sessionMode: options.executionMode });
  return [
    'run',
    '--format',
    'json',
    ...(mode === 'auto' ? ['--auto'] : []),
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
  executionMode?: ExecutionMode | null;
  extraDirs?: readonly string[];
}): LaunchSpec {
  const options: TurnModelOptions = {
    model: ctx.model,
    effort: ctx.effort,
    executionMode: ctx.executionMode,
    extraDirs: ctx.extraDirs,
  };
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
