import { accessSync, constants, statSync } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, extname, join } from 'node:path';

export function readEnvVar(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(env, name) && env[name] !== undefined) {
    return env[name];
  }
  const target = name.toUpperCase();
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === target && env[key] !== undefined) {
      return env[key];
    }
  }
  return undefined;
}

export function readEnvPath(env: NodeJS.ProcessEnv): string {
  return readEnvVar(env, 'PATH') ?? '';
}

export function normalizeWindowsEnv(
  env: NodeJS.ProcessEnv,
  pathOverride?: string,
): NodeJS.ProcessEnv {
  const normalized: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PATH') continue;
    normalized[key] = env[key];
  }
  normalized['PATH'] = pathOverride ?? readEnvPath(env);
  return normalized;
}

function binaryCandidates(input: {
  name: string;
  pathValue: string;
  platform: NodeJS.Platform;
  delimiter: string;
}): string[] {
  const hasExt = extname(input.name) !== '';
  const suffixes =
    input.platform === 'win32' ? (hasExt ? [''] : ['.exe', '.com', '.cmd', '.bat']) : [''];
  const candidates: string[] = [];
  for (const rawDir of input.pathValue.split(input.delimiter)) {
    const dir = input.platform === 'win32' ? rawDir.trim().replace(/^"+|"+$/g, '') : rawDir;
    if (dir === '') continue;
    for (const suffix of suffixes) {
      candidates.push(join(dir, `${input.name}${suffix}`));
    }
  }
  return candidates;
}

async function isExecutableFile(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    if (platform !== 'win32') await access(path, constants.X_OK);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error) return false;
    throw error;
  }
}

function isExecutableFileSync(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== 'win32') accessSync(path, constants.X_OK);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error) return false;
    throw error;
  }
}

export async function findBinaryInPath(input: {
  name: string;
  pathValue: string;
  platform?: NodeJS.Platform;
  delimiter?: string;
}): Promise<string | undefined> {
  const platform = input.platform ?? process.platform;
  const candidates = binaryCandidates({
    name: input.name,
    pathValue: input.pathValue,
    platform,
    delimiter: input.delimiter ?? delimiter,
  });
  for (const candidate of candidates) {
    if (await isExecutableFile(candidate, platform)) return candidate;
  }
  return undefined;
}

export function findBinaryInPathSync(input: {
  name: string;
  pathValue: string;
  platform?: NodeJS.Platform;
  delimiter?: string;
}): string | undefined {
  const platform = input.platform ?? process.platform;
  const candidates = binaryCandidates({
    name: input.name,
    pathValue: input.pathValue,
    platform,
    delimiter: input.delimiter ?? delimiter,
  });
  for (const candidate of candidates) {
    if (isExecutableFileSync(candidate, platform)) return candidate;
  }
  return undefined;
}

function quoteWindowsArg(arg: string): string {
  if (arg !== '' && !/[\s"&|<>()^]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

export function resolveWindowsSpawn(input: {
  file: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): { file: string; args: string[]; verbatimArgs?: string } {
  const platform = input.platform ?? process.platform;
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(input.file)) {
    const comspec = readEnvVar(input.env, 'ComSpec') || 'cmd.exe';
    const commandLine = [input.file, ...input.args].map(quoteWindowsArg).join(' ');
    return {
      file: comspec,
      args: ['/d', '/s', '/c', `"${commandLine}"`],
      verbatimArgs: `/d /s /c "${commandLine}"`,
    };
  }
  return { file: input.file, args: [...input.args] };
}
