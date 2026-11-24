import { spawn } from 'node:child_process';
import type { GithubLoginEvent, GithubStatus, Result } from '../shared/api.js';
import { fail, ok } from './validation.js';

export const GITHUB_HOST = 'github.com';
export const GITHUB_DEVICE_URL = 'https://github.com/login/device';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 20_000;
const MAX_BUFFER_CHARS = 16_384;
const MAX_MESSAGE_CHARS = 200;

// REGEX: strip VT OSC, CSI, and single-char escape sequences emitted by CLIs
const ANSI_ESCAPE =
  /\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g;
// REGEX: one-time device code, e.g. ABCD-1234, with at least one letter (rejects dates and numbers)
const DEVICE_CODE = /\b(?=[0-9-]*[A-Z])[A-Z0-9]{4}-[A-Z0-9]{4}\b/;
// REGEX: GitHub device verification URL on github.com only
const DEVICE_URL = /https:\/\/github\.com\/login\/device\b[^\s"'<>]*/;
// REGEX: gh asks the user to press Enter before it opens the browser
const PRESS_ENTER = /press enter/i;
// REGEX: GitHub token shapes (classic, OAuth, fine-grained) and bearer-like long secrets
const TOKEN_SHAPE =
  /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b|\b[A-Fa-f0-9]{40}\b/g;
// REGEX: header line of one account block in `gh auth status`
const LOGGED_IN_LINE = /Logged in to (\S+) (?:account|as) (\S+)/gi;
// REGEX: scopes line in `gh auth status`
const SCOPES_LINE = /Token scopes?:\s*(.*)/i;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

export function redactSecrets(text: string): string {
  return text.replace(TOKEN_SHAPE, '[oculto]');
}

export function parseGithubStatus(input: {
  code: number | null;
  output: string;
}): Omit<GithubStatus, 'installed'> {
  const clean = stripAnsi(input.output);
  const matches = [...clean.matchAll(LOGGED_IN_LINE)];
  if (input.code !== 0 || matches.length === 0) return { loggedIn: false, user: null };
  const blocks = matches.map((match, index) => ({
    user: match[2] ?? null,
    text: clean.slice(match.index, matches[index + 1]?.index ?? clean.length),
  }));
  const chosen =
    blocks.find((block) => /Active account:\s*true/i.test(block.text)) ?? blocks[0] ?? null;
  const scopesRaw = chosen ? SCOPES_LINE.exec(chosen.text)?.[1] : undefined;
  const scopes = scopesRaw
    ? [...scopesRaw.matchAll(/'([^']+)'|"([^"]+)"|([A-Za-z0-9:_-]+)/g)]
        .map((match) => match[1] ?? match[2] ?? match[3] ?? '')
        .filter((scope) => scope !== '')
    : [];
  return {
    loggedIn: true,
    user: chosen?.user ?? null,
    ...(scopes.length > 0 ? { scopes } : {}),
  };
}

export function parseDeviceLogin(output: string): { code: string; url: string } | null {
  const clean = stripAnsi(output);
  const code = DEVICE_CODE.exec(clean)?.[0];
  if (code === undefined) return null;
  return { code, url: DEVICE_URL.exec(clean)?.[0] ?? GITHUB_DEVICE_URL };
}

export function wantsEnterKey(output: string): boolean {
  return PRESS_ENTER.test(stripAnsi(output));
}

export function safeFailureMessage(output: string, fallback: string): string {
  const lines = redactSecrets(stripAnsi(output))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const last = lines[lines.length - 1];
  if (last === undefined) return fallback;
  return last.length > MAX_MESSAGE_CHARS ? `${last.slice(0, MAX_MESSAGE_CHARS)}…` : last;
}

export interface GithubProcess {
  onOutput(callback: (chunk: string) => void): void;
  onExit(callback: (code: number | null) => void): void;
  onError(callback: (error: Error) => void): void;
  write(data: string): void;
  kill(): void;
}

export interface GithubAuthDeps {
  findGh: () => Promise<string | undefined>;
  getEnv: () => Promise<NodeJS.ProcessEnv>;
  spawn: (input: { file: string; args: string[]; env: NodeJS.ProcessEnv }) => GithubProcess;
  emit: (event: GithubLoginEvent) => void;
  loginTimeoutMs?: number;
  commandTimeoutMs?: number;
}

export function spawnGithubProcess(input: {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}): GithubProcess {
  const child = spawn(input.file, input.args, {
    env: input.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdin.on('error', () => undefined);
  return {
    onOutput: (callback) => {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', callback);
      child.stderr.on('data', callback);
    },
    onExit: (callback) => child.on('close', callback),
    onError: (callback) => child.on('error', callback),
    write: (data) => {
      if (!child.stdin.destroyed) child.stdin.write(data);
    },
    kill: () => {
      child.kill();
    },
  };
}

interface CommandResult {
  code: number | null;
  output: string;
  failedToStart: boolean;
}

export function createGithubAuth(deps: GithubAuthDeps) {
  let current: { process: GithubProcess; canceled: boolean } | null = null;

  async function baseEnv(): Promise<NodeJS.ProcessEnv> {
    return {
      ...(await deps.getEnv()),
      NO_COLOR: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
    };
  }

  async function runCommand(input: {
    file: string;
    args: string[];
    stdin?: string;
  }): Promise<CommandResult> {
    const env = await baseEnv();
    return new Promise<CommandResult>((resolve) => {
      let output = '';
      let settled = false;
      const child = deps.spawn({ file: input.file, args: input.args, env });
      const finish = (result: CommandResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish({ code: null, output, failedToStart: false });
      }, deps.commandTimeoutMs ?? COMMAND_TIMEOUT_MS);
      child.onOutput((chunk) => {
        output = (output + chunk).slice(-MAX_BUFFER_CHARS);
      });
      child.onExit((code) => finish({ code, output, failedToStart: false }));
      child.onError(() => finish({ code: null, output, failedToStart: true }));
      if (input.stdin !== undefined) child.write(input.stdin);
    });
  }

  async function getStatus(): Promise<GithubStatus> {
    const file = await deps.findGh();
    if (file === undefined) return { installed: false, loggedIn: false, user: null };
    const version = await runCommand({ file, args: ['--version'] });
    if (version.failedToStart) return { installed: false, loggedIn: false, user: null };
    const status = await runCommand({
      file,
      args: ['auth', 'status', '--hostname', GITHUB_HOST],
    });
    if (status.failedToStart) return { installed: false, loggedIn: false, user: null };
    return { installed: true, ...parseGithubStatus(status) };
  }

  async function startLogin(): Promise<Result<null>> {
    if (current !== null) return fail('Já existe um login do GitHub em andamento.');
    const file = await deps.findGh();
    if (file === undefined) {
      return fail('GitHub CLI (gh) não encontrado. Instale com: brew install gh');
    }
    if (current !== null) return fail('Já existe um login do GitHub em andamento.');
    const env = await baseEnv();
    const child = deps.spawn({
      file,
      args: [
        'auth',
        'login',
        '--hostname',
        GITHUB_HOST,
        '--git-protocol',
        'https',
        '--web',
        '--scopes',
        'repo,read:org',
      ],
      env,
    });
    const state = { process: child, canceled: false };
    current = state;
    let buffer = '';
    let codeSent = false;
    let enterSent = false;
    let done = false;
    const finish = (event: GithubLoginEvent | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (current === state) current = null;
      if (event !== null && !state.canceled) deps.emit(event);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ type: 'failed', message: 'Tempo esgotado esperando a autorização do GitHub.' });
    }, deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS);
    child.onOutput((chunk) => {
      if (done) return;
      buffer = (buffer + chunk).slice(-MAX_BUFFER_CHARS);
      if (!codeSent) {
        const device = parseDeviceLogin(buffer);
        if (device !== null) {
          codeSent = true;
          deps.emit({ type: 'code-ready', code: device.code, url: device.url });
        }
      }
      if (!enterSent && wantsEnterKey(buffer)) {
        enterSent = true;
        child.write('\n');
      }
    });
    child.onExit((code) => {
      if (code === 0) {
        finish({ type: 'succeeded' });
        return;
      }
      finish({
        type: 'failed',
        message: safeFailureMessage(buffer, 'O login do GitHub falhou.'),
      });
    });
    child.onError((error) => {
      finish({
        type: 'failed',
        message: safeFailureMessage(error.message, 'Não foi possível executar o gh.'),
      });
    });
    return ok(null);
  }

  function cancelLogin(): boolean {
    if (current === null) return false;
    current.canceled = true;
    const { process: child } = current;
    current = null;
    child.kill();
    return true;
  }

  async function logout(): Promise<Result<null>> {
    if (current !== null) return fail('Cancele o login do GitHub em andamento primeiro.');
    const file = await deps.findGh();
    if (file === undefined) return fail('GitHub CLI (gh) não encontrado.');
    const status = await getStatus();
    const base = ['auth', 'logout', '--hostname', GITHUB_HOST];
    const withUser = status.user === null ? base : [...base, '--user', status.user];
    let result = await runCommand({ file, args: withUser, stdin: 'Y\n' });
    if (result.code !== 0 && withUser !== base && /unknown flag/i.test(result.output)) {
      result = await runCommand({ file, args: base, stdin: 'Y\n' });
    }
    if (result.code === 0) return ok(null);
    return fail(safeFailureMessage(result.output, 'Não foi possível desconectar do GitHub.'));
  }

  return {
    getStatus,
    startLogin,
    cancelLogin,
    logout,
    dispose: (): void => {
      cancelLogin();
    },
  };
}

export type GithubAuth = ReturnType<typeof createGithubAuth>;

export function createGithubHandlers(auth: GithubAuth) {
  return {
    getGithubStatus: async (): Promise<Result<GithubStatus>> => ok(await auth.getStatus()),
    startGithubLogin: (): Promise<Result<null>> => auth.startLogin(),
    cancelGithubLogin: async (): Promise<Result<null>> => {
      auth.cancelLogin();
      return ok(null);
    },
    logoutGithub: (): Promise<Result<null>> => auth.logout(),
  };
}

export type GithubHandlers = ReturnType<typeof createGithubHandlers>;
