import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderId } from './types.js';

export type AuthStatus = 'logged-in' | 'logged-out' | 'binary-missing' | 'unknown';

export interface CommandRunner {
  run(cmd: {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
  }): Promise<{ exitCode: number; stdout: string } | { notFound: true }>;
}

export interface ProviderAdapter {
  id: ProviderId;
  binary: string;
  homeEnvVar: string;
  strippedEnvVars: readonly string[];
  loginArgs: readonly string[];
  installHint: string;
  initHome(homeDir: string): Promise<void>;
  checkStatus(ctx: {
    homeDir: string;
    env: NodeJS.ProcessEnv;
    runner: CommandRunner;
  }): Promise<AuthStatus>;
}

type StatusContext = Parameters<ProviderAdapter['checkStatus']>[0];

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function noop(): Promise<void> {}

function runInHome(
  adapter: Pick<ProviderAdapter, 'binary' | 'homeEnvVar'>,
  ctx: StatusContext,
  args: string[],
): ReturnType<CommandRunner['run']> {
  return ctx.runner.run({
    command: adapter.binary,
    args,
    env: { ...ctx.env, [adapter.homeEnvVar]: ctx.homeDir },
  });
}

function parseClaudeStatus(stdout: string): AuthStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return 'unknown';
  }
  if (typeof parsed !== 'object' || parsed === null) return 'unknown';
  const loggedIn = (parsed as Record<string, unknown>)['loggedIn'];
  if (loggedIn === true) return 'logged-in';
  if (loggedIn === false) return 'logged-out';
  return 'unknown';
}

const claude: ProviderAdapter = {
  id: 'claude',
  binary: 'claude',
  homeEnvVar: 'CLAUDE_CONFIG_DIR',
  strippedEnvVars: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
  loginArgs: ['auth', 'login'],
  installHint: 'pnpm add -g @anthropic-ai/claude-code',
  initHome: noop,
  async checkStatus(ctx) {
    const result = await runInHome(claude, ctx, ['auth', 'status', '--json']);
    return 'notFound' in result ? 'binary-missing' : parseClaudeStatus(result.stdout);
  },
};

async function createFileIfMissing(file: string, content: string): Promise<void> {
  try {
    await writeFile(file, content, { flag: 'wx' });
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return;
    throw error;
  }
}

const codex: ProviderAdapter = {
  id: 'codex',
  binary: 'codex',
  homeEnvVar: 'CODEX_HOME',
  strippedEnvVars: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  loginArgs: ['login'],
  installHint: 'pnpm add -g @openai/codex',
  initHome: (homeDir) =>
    createFileIfMissing(join(homeDir, 'config.toml'), 'cli_auth_credentials_store = "file"\n'),
  async checkStatus(ctx) {
    const result = await runInHome(codex, ctx, ['login', 'status']);
    if ('notFound' in result) return 'binary-missing';
    return result.exitCode === 0 ? 'logged-in' : 'logged-out';
  },
};

const gemini: ProviderAdapter = {
  id: 'gemini',
  binary: 'gemini',
  homeEnvVar: 'GEMINI_CLI_HOME',
  strippedEnvVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI'],
  loginArgs: [],
  installHint: 'pnpm add -g @google/gemini-cli',
  initHome: noop,
  async checkStatus(ctx) {
    const result = await runInHome(gemini, ctx, ['--version']);
    if ('notFound' in result) return 'binary-missing';
    return access(join(ctx.homeDir, '.gemini', 'oauth_creds.json')).then(
      () => 'logged-in',
      (error: unknown) => (isMissingFile(error) ? 'logged-out' : 'unknown'),
    );
  },
};

export const providers: Record<ProviderId, ProviderAdapter> = { claude, codex, gemini };

export function isProviderId(value: string): value is ProviderId {
  return Object.hasOwn(providers, value);
}
