import { lstat, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Account, ProviderId } from './types.js';

export type AuthStatus = 'logged-in' | 'logged-out' | 'binary-missing' | 'unknown';

export const RUNNER_ABORTED = -1;

export interface CommandRunner {
  run(cmd: {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    cwd?: string;
    timeoutMs?: number;
  }): Promise<{ exitCode: number; stdout: string } | { notFound: true }>;
}

export interface ProviderAdapter {
  id: ProviderId;
  binary: string;
  homeEnvVar: string;
  strippedEnvVars: readonly string[];
  forcedEnv?: Readonly<Record<string, string>>;
  loginArgs: readonly string[];
  installHint: string;
  initHome(homeDir: string): Promise<void>;
  prepareLaunch(homeDir: string, realHome?: string): Promise<void>;
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

// NOTE: `claude auth login` never sets hasCompletedOnboarding, so interactive claude reruns onboarding + login.
async function markClaudeOnboarded(homeDir: string): Promise<void> {
  const file = join(homeDir, '.claude.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error: unknown) {
    if (isMissingFile(error)) return;
    throw error;
  }
  const config: unknown = JSON.parse(raw);
  if (typeof config !== 'object' || config === null) return;
  if ((config as Record<string, unknown>)['hasCompletedOnboarding'] === true) return;
  await writeFile(`${file}.inova.tmp`, JSON.stringify({ ...config, hasCompletedOnboarding: true }));
  await rename(`${file}.inova.tmp`, file);
}

const claude: ProviderAdapter = {
  id: 'claude',
  binary: 'claude',
  homeEnvVar: 'CLAUDE_CONFIG_DIR',
  strippedEnvVars: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
  loginArgs: ['auth', 'login'],
  installHint: 'pnpm add -g @anthropic-ai/claude-code',
  initHome: noop,
  prepareLaunch: markClaudeOnboarded,
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
  prepareLaunch: noop,
  async checkStatus(ctx) {
    const result = await runInHome(codex, ctx, ['login', 'status']);
    if ('notFound' in result) return 'binary-missing';
    if (result.exitCode === RUNNER_ABORTED) return 'unknown';
    return result.exitCode === 0 ? 'logged-in' : 'logged-out';
  },
};

const AGY_TOKEN_REL_PATH = join('.gemini', 'antigravity-cli', 'antigravity-oauth-token');
const AGY_REAUTH_BACKUP_SUFFIX = '.inova-reauth';
// NOTE: agy keeps its OAuth token in one global macOS Keychain item (service "gemini"), shared by every HOME. With HOME isolated, /usr/bin/security finds no default keychain, so macOS shows the "Keychain Not Found" dialog on every token refresh. An SSH session makes agy use only the token file inside the account home.
const AGY_FILE_TOKEN_STORAGE_ENV = { SSH_CONNECTION: '127.0.0.1 0 127.0.0.1 0' } as const;
const AGY_GLOBAL_SYMLINKS = [
  '.gitconfig',
  '.gitignore_global',
  '.ssh',
  '.npmrc',
  join('.config', 'gh'),
] as const;

async function readOptionalText(file: string): Promise<string | 'missing' | 'error'> {
  try {
    return await readFile(file, 'utf8');
  } catch (error: unknown) {
    return isMissingFile(error) ? 'missing' : 'error';
  }
}

export async function readGeminiAuthState(homeDir: string): Promise<AuthStatus> {
  const token = await readOptionalText(join(homeDir, AGY_TOKEN_REL_PATH));
  if (token === 'error') return 'unknown';
  return token !== 'missing' && token.trim() !== '' ? 'logged-in' : 'logged-out';
}

async function renameIfExists(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error: unknown) {
    if (!isMissingFile(error)) throw error;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error: unknown) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

export async function beginForcedReauth(
  account: Pick<Account, 'provider' | 'homeDir'>,
): Promise<() => Promise<void>> {
  if (account.provider !== 'gemini') return noop;
  const token = join(account.homeDir, AGY_TOKEN_REL_PATH);
  const backup = `${token}${AGY_REAUTH_BACKUP_SUFFIX}`;
  await renameIfExists(token, backup);
  return async () => {
    if (await fileExists(token)) {
      await rm(backup, { force: true });
      return;
    }
    await renameIfExists(backup, token);
  };
}

async function linkIfNeeded(src: string, dst: string): Promise<void> {
  try {
    await lstat(src);
  } catch (error: unknown) {
    if (isMissingFile(error)) return;
    throw error;
  }
  try {
    await lstat(dst);
    return;
  } catch (error: unknown) {
    if (!isMissingFile(error)) throw error;
  }
  await mkdir(dirname(dst), { recursive: true });
  try {
    await symlink(src, dst);
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
}

export async function prepareAgyHome(homeDir: string, realHome = homedir()): Promise<void> {
  if (resolve(homeDir) === resolve(realHome)) return;
  await Promise.all(
    AGY_GLOBAL_SYMLINKS.map((rel) => linkIfNeeded(join(realHome, rel), join(homeDir, rel))),
  );
}

const gemini: ProviderAdapter = {
  id: 'gemini',
  binary: 'agy',
  homeEnvVar: 'HOME',
  strippedEnvVars: [
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_GENAI_USE_VERTEXAI',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_PROJECT_ID',
  ],
  forcedEnv: AGY_FILE_TOKEN_STORAGE_ENV,
  loginArgs: [],
  installHint: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
  initHome: noop,
  prepareLaunch: prepareAgyHome,
  async checkStatus(ctx) {
    const result = await runInHome(gemini, ctx, ['--version']);
    if ('notFound' in result) return 'binary-missing';
    if (result.exitCode === RUNNER_ABORTED) return 'unknown';
    return readGeminiAuthState(ctx.homeDir);
  },
};

function hasValidJsonCredentials(raw: string): boolean {
  const record = parseJsonRecord(raw);
  if (!record) return false;
  return Object.values(record).some((value) => {
    if (typeof value === 'string') return value.trim() !== '';
    if (isRecord(value)) return Object.keys(value).length > 0;
    return value === true;
  });
}

async function readCredentialFilesStatus(
  homeDir: string,
  relPaths: readonly string[],
): Promise<AuthStatus> {
  for (const rel of relPaths) {
    const raw = await readOptionalText(join(homeDir, rel));
    if (raw === 'error') return 'unknown';
    if (raw === 'missing') continue;
    const valid = rel.endsWith('.json') ? hasValidJsonCredentials(raw) : raw.trim() !== '';
    if (valid) return 'logged-in';
  }
  return 'logged-out';
}

interface FileAuthConfig {
  id: ProviderId;
  binary: string;
  homeEnvVar: string;
  strippedEnvVars: readonly string[];
  loginArgs: readonly string[];
  installHint: string;
  credentialFiles: readonly string[];
  symlinkHome?: boolean;
}

function createFileAuthAdapter(config: FileAuthConfig): ProviderAdapter {
  const adapter: ProviderAdapter = {
    id: config.id,
    binary: config.binary,
    homeEnvVar: config.homeEnvVar,
    strippedEnvVars: config.strippedEnvVars,
    loginArgs: config.loginArgs,
    installHint: config.installHint,
    initHome: noop,
    prepareLaunch: config.symlinkHome ? prepareAgyHome : noop,
    async checkStatus(ctx) {
      const result = await runInHome(adapter, ctx, ['--version']);
      if ('notFound' in result) return 'binary-missing';
      if (result.exitCode === RUNNER_ABORTED) return 'unknown';
      return readCredentialFilesStatus(ctx.homeDir, config.credentialFiles);
    },
  };
  return adapter;
}

export const PROVIDER_CREDENTIAL_FILES: Partial<Record<ProviderId, readonly string[]>> = {
  gemini: [AGY_TOKEN_REL_PATH],
  deepseek: ['.credentials.yaml', 'credentials.yaml', 'auth.json'],
  kimi: [join('credentials', 'kimi-code.json'), 'kimi-code.json', 'auth.json'],
  grok: ['auth.json', 'credentials.json'],
  qwen: [join('.qwen', 'oauth_creds.json'), join('.qwen', 'auth.json')],
  opencode: [join('opencode', 'auth.json')],
};

const deepseek = createFileAuthAdapter({
  id: 'deepseek',
  binary: 'dsh',
  homeEnvVar: 'DSH_HOME',
  strippedEnvVars: ['DEEPSEEK_API_KEY'],
  loginArgs: [],
  installHint: 'npm i -g @deepseek-ai/dsh',
  credentialFiles: PROVIDER_CREDENTIAL_FILES.deepseek ?? [],
});

const kimi = createFileAuthAdapter({
  id: 'kimi',
  binary: 'kimi',
  homeEnvVar: 'KIMI_CODE_HOME',
  strippedEnvVars: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
  loginArgs: ['login'],
  installHint: 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',
  credentialFiles: PROVIDER_CREDENTIAL_FILES.kimi ?? [],
});

const grok = createFileAuthAdapter({
  id: 'grok',
  binary: 'grok',
  homeEnvVar: 'GROK_HOME',
  strippedEnvVars: ['XAI_API_KEY', 'GROK_API_KEY'],
  loginArgs: ['login'],
  installHint: 'curl -fsSL https://x.ai/cli/install.sh | bash',
  credentialFiles: PROVIDER_CREDENTIAL_FILES.grok ?? [],
});

const qwen = createFileAuthAdapter({
  id: 'qwen',
  binary: 'qwen',
  homeEnvVar: 'HOME',
  strippedEnvVars: ['DASHSCOPE_API_KEY', 'OPENAI_API_KEY', 'QWEN_API_KEY'],
  loginArgs: [],
  installHint: 'pnpm add -g @qwen-code/qwen-code',
  credentialFiles: PROVIDER_CREDENTIAL_FILES.qwen ?? [],
  symlinkHome: true,
});

const opencode = createFileAuthAdapter({
  id: 'opencode',
  binary: 'opencode',
  homeEnvVar: 'XDG_DATA_HOME',
  strippedEnvVars: ['OPENCODE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'],
  loginArgs: ['auth', 'login'],
  installHint: 'curl -fsSL https://opencode.ai/v2/install | bash',
  credentialFiles: PROVIDER_CREDENTIAL_FILES.opencode ?? [],
});

export const providers: Record<ProviderId, ProviderAdapter> = {
  claude,
  codex,
  gemini,
  deepseek,
  kimi,
  grok,
  qwen,
  opencode,
};

export function isProviderId(value: string): value is ProviderId {
  return Object.hasOwn(providers, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed !== '' && trimmed.includes('@') ? trimmed : null;
}

function extractJwtEmail(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  const payload = parts[1];
  if (!payload) return null;
  const decoded = parseJsonRecord(Buffer.from(payload, 'base64url').toString('utf8'));
  return decoded ? normalizeEmail(decoded['email']) : null;
}

async function readJsonFile(file: string): Promise<Record<string, unknown> | null> {
  const raw = await readOptionalText(file);
  if (raw === 'missing' || raw === 'error') return null;
  return parseJsonRecord(raw);
}

function extractRecordEmail(record: Record<string, unknown>): string | null {
  const direct = normalizeEmail(record['email']);
  if (direct !== null) return direct;
  const oauth = isRecord(record['oauthAccount']) ? record['oauthAccount'] : null;
  const oauthEmail = normalizeEmail(oauth?.['emailAddress'] ?? oauth?.['email']);
  if (oauthEmail !== null) return oauthEmail;
  const user = isRecord(record['user']) ? record['user'] : null;
  const userEmail = normalizeEmail(user?.['email']);
  if (userEmail !== null) return userEmail;
  const tokens = isRecord(record['tokens']) ? record['tokens'] : null;
  const jwt = extractJwtEmail(tokens?.['id_token'] ?? record['id_token']);
  if (jwt !== null) return jwt;
  for (const nested of Object.values(record)) {
    if (!isRecord(nested)) continue;
    const nestedEmail = normalizeEmail(nested['email']) ?? extractJwtEmail(nested['id_token']);
    if (nestedEmail !== null) return nestedEmail;
  }
  return null;
}

export async function readAccountEmail(input: {
  provider: ProviderId;
  homeDir: string;
}): Promise<string | null> {
  switch (input.provider) {
    case 'claude': {
      const record = await readJsonFile(join(input.homeDir, '.claude.json'));
      const oauth = record && isRecord(record['oauthAccount']) ? record['oauthAccount'] : null;
      return normalizeEmail(oauth?.['emailAddress']);
    }
    case 'codex': {
      const record = await readJsonFile(join(input.homeDir, 'auth.json'));
      if (!record) return null;
      const direct = normalizeEmail(record['email']);
      if (direct !== null) return direct;
      const tokens = isRecord(record['tokens']) ? record['tokens'] : null;
      return extractJwtEmail(tokens?.['id_token'] ?? record['id_token']);
    }
    case 'gemini': {
      const record = await readJsonFile(join(input.homeDir, AGY_TOKEN_REL_PATH));
      if (!record) return null;
      return (
        normalizeEmail(record['id_token_email']) ??
        normalizeEmail(record['email']) ??
        extractJwtEmail(record['id_token'])
      );
    }
    case 'deepseek':
    case 'kimi':
    case 'grok':
    case 'qwen':
    case 'opencode': {
      const files = PROVIDER_CREDENTIAL_FILES[input.provider] ?? [];
      for (const rel of files) {
        if (!rel.endsWith('.json')) continue;
        const record = await readJsonFile(join(input.homeDir, rel));
        if (!record) continue;
        const email = extractRecordEmail(record);
        if (email !== null) return email;
      }
      return null;
    }
  }
}
