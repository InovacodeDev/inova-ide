import { execFile } from 'node:child_process';
import { delimiter, win32 } from 'node:path';
import { promisify } from 'node:util';
import {
  findBinaryInPath,
  normalizeWindowsEnv,
  readEnvPath,
  readEnvVar,
  resolveWindowsSpawn,
} from '@inova/win-env';

export { normalizeWindowsEnv, readEnvPath, resolveWindowsSpawn };

const execFileAsync = promisify(execFile);
const PATH_MARKER = '__INOVA_PATH__';
const REGISTRY_TIMEOUT_MS = 2000;
const WIN_USER_ENV_KEY = 'HKCU\\Environment';
const WIN_MACHINE_ENV_KEY =
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
// REGEX: match `Path REG_SZ <value>` or `Path REG_EXPAND_SZ <value>` line from `reg query`
const REG_PATH_LINE = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/im;

export async function loginShellPath(ctx: {
  shell: string;
  fallback: string;
  timeoutMs: number;
}): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      ctx.shell,
      ['-ilc', `printf "${PATH_MARKER}%s" "$PATH"`],
      { timeout: ctx.timeoutMs, killSignal: 'SIGKILL', encoding: 'utf8' },
    );
    const index = stdout.lastIndexOf(PATH_MARKER);
    if (index === -1) return ctx.fallback;
    return stdout.slice(index + PATH_MARKER.length) || ctx.fallback;
  } catch (error: unknown) {
    if (error instanceof Error) return ctx.fallback;
    throw error;
  }
}

export function findBinary(
  name: string,
  pathValue: string,
  opts?: { platform?: NodeJS.Platform; delimiter?: string },
): Promise<string | undefined> {
  return findBinaryInPath({
    name,
    pathValue,
    ...(opts?.platform === undefined ? {} : { platform: opts.platform }),
    ...(opts?.delimiter === undefined ? {} : { delimiter: opts.delimiter }),
  });
}

export function expandWindowsEnvVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => readEnvVar(env, name) ?? match);
}

export function windowsUserCliDirs(env: NodeJS.ProcessEnv): string[] {
  const home = readEnvVar(env, 'USERPROFILE') || readEnvVar(env, 'HOME');
  const localAppData =
    readEnvVar(env, 'LOCALAPPDATA') || (home ? win32.join(home, 'AppData', 'Local') : undefined);
  const appData =
    readEnvVar(env, 'APPDATA') || (home ? win32.join(home, 'AppData', 'Roaming') : undefined);
  const dirs = [
    home ? win32.join(home, '.local', 'bin') : undefined,
    localAppData ? win32.join(localAppData, 'pnpm') : undefined,
    appData ? win32.join(appData, 'npm') : undefined,
    localAppData ? win32.join(localAppData, 'Microsoft', 'WinGet', 'Links') : undefined,
    home ? win32.join(home, '.bun', 'bin') : undefined,
    home ? win32.join(home, 'scoop', 'shims') : undefined,
    home ? win32.join(home, '.cargo', 'bin') : undefined,
  ];
  return dirs.filter((dir): dir is string => dir !== undefined);
}

export function mergePathEntries(input: {
  parts: readonly (string | undefined)[];
  delimiter?: string;
  caseInsensitive?: boolean;
}): string {
  const sep = input.delimiter ?? delimiter;
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const part of input.parts) {
    if (part === undefined || part === '') continue;
    for (const rawEntry of part.split(sep)) {
      const entry = input.caseInsensitive ? rawEntry.trim().replace(/^"+|"+$/g, '') : rawEntry;
      if (entry === '') continue;
      const key = input.caseInsensitive ? entry.toLowerCase() : entry;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  return entries.join(sep);
}

export function parseRegQueryPath(stdout: string): string | undefined {
  const match = REG_PATH_LINE.exec(stdout);
  const value = match?.[1]?.trim();
  return value ? value : undefined;
}

export async function queryWindowsRegistryPath(
  regKey: string,
  timeoutMs = REGISTRY_TIMEOUT_MS,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', regKey, '/v', 'Path'], {
      timeout: timeoutMs,
      encoding: 'utf8',
      windowsHide: true,
    });
    return parseRegQueryPath(stdout);
  } catch (error: unknown) {
    if (error instanceof Error) return undefined;
    throw error;
  }
}

export async function windowsPath(ctx?: {
  env?: NodeJS.ProcessEnv;
  queryRegistryPath?: (key: string) => Promise<string | undefined>;
}): Promise<string> {
  const env = ctx?.env ?? process.env;
  const query = ctx?.queryRegistryPath ?? queryWindowsRegistryPath;
  const [userRaw, machineRaw] = await Promise.all([
    query(WIN_USER_ENV_KEY),
    query(WIN_MACHINE_ENV_KEY),
  ]);
  return mergePathEntries({
    parts: [
      readEnvPath(env),
      userRaw ? expandWindowsEnvVars(userRaw, env) : undefined,
      machineRaw ? expandWindowsEnvVars(machineRaw, env) : undefined,
      ...windowsUserCliDirs(env),
    ],
    delimiter: ';',
    caseInsensitive: true,
  });
}

export async function windowsBaseEnv(ctx?: {
  env?: NodeJS.ProcessEnv;
  queryRegistryPath?: (key: string) => Promise<string | undefined>;
}): Promise<NodeJS.ProcessEnv> {
  const source = ctx?.env ?? process.env;
  const path = await windowsPath({ env: source, queryRegistryPath: ctx?.queryRegistryPath });
  return {
    ...normalizeWindowsEnv(source, path),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };
}
