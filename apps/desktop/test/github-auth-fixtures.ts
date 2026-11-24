import type { GithubLoginEvent } from '../src/shared/api.js';
import {
  createGithubAuth,
  type GithubAuthDeps,
  type GithubProcess,
} from '../src/main/github-auth.js';

export class FakeGithubProcess implements GithubProcess {
  readonly writes: string[] = [];
  killed = false;
  private outputCallbacks: ((chunk: string) => void)[] = [];
  private exitCallbacks: ((code: number | null) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];

  constructor(
    readonly file: string,
    readonly args: string[],
  ) {}

  onOutput(callback: (chunk: string) => void): void {
    this.outputCallbacks.push(callback);
  }
  onExit(callback: (code: number | null) => void): void {
    this.exitCallbacks.push(callback);
  }
  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback);
  }
  write(data: string): void {
    this.writes.push(data);
  }
  kill(): void {
    this.killed = true;
  }

  output(chunk: string): void {
    for (const callback of this.outputCallbacks) callback(chunk);
  }
  exit(code: number | null): void {
    for (const callback of this.exitCallbacks) callback(code);
  }
  fail(error: Error): void {
    for (const callback of this.errorCallbacks) callback(error);
  }
}

export function setupGithub(options?: {
  gh?: string | null;
  loginTimeoutMs?: number;
  commandTimeoutMs?: number;
}) {
  const processes: FakeGithubProcess[] = [];
  const events: GithubLoginEvent[] = [];
  const gh = options?.gh === undefined ? '/usr/bin/gh' : options.gh;
  const deps: GithubAuthDeps = {
    findGh: async () => gh ?? undefined,
    getEnv: async () => ({ PATH: '/usr/bin' }),
    spawn: ({ file, args }) => {
      const process = new FakeGithubProcess(file, args);
      processes.push(process);
      return process;
    },
    emit: (event) => events.push(event),
    ...(options?.loginTimeoutMs === undefined ? {} : { loginTimeoutMs: options.loginTimeoutMs }),
    ...(options?.commandTimeoutMs === undefined
      ? {}
      : { commandTimeoutMs: options.commandTimeoutMs }),
  };
  const auth = createGithubAuth(deps);
  return { auth, processes, events };
}

export async function nextProcess(
  processes: readonly FakeGithubProcess[],
  index: number,
): Promise<FakeGithubProcess> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = processes[index];
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`process ${index} was never spawned`);
}

export const STATUS_LOGGED_IN = [
  'github.com',
  '  ✓ Logged in to github.com account octocat (keyring)',
  '  - Active account: true',
  '  - Git operations protocol: https',
  '  - Token: gho_************************************',
  "  - Token scopes: 'gist', 'read:org', 'repo'",
  '',
].join('\n');

export const LOGIN_OUTPUT = [
  '! First copy your one-time code: ABCD-1234',
  'Press Enter to open github.com in your browser... ',
].join('\n');
