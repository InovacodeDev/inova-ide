import { isRecord } from './validation.js';

export type CommandCwd = 'project' | 'ide-root' | 'none';

export interface CommandSpec {
  id: string;
  binary: string;
  parseArgs: (params: unknown) => string[] | undefined;
  cwd: CommandCwd;
  mode: 'exec';
  mutating: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
}

const MAX_TOKEN_LENGTH = 100;
const ONE_MINUTE_MS = 60_000;
const ONE_MEGABYTE = 1024 * 1024;
// REGEX: allowlist for a CLI value: starts with a letter or digit (never "-"), then letters, digits, ".", "_", "/", "-"
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function isSafeToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_TOKEN_LENGTH &&
    SAFE_TOKEN.test(value) &&
    !value.includes('..')
  );
}

export function noParams(params: unknown): true | undefined {
  if (params === undefined || params === null) return true;
  return isRecord(params) && Object.keys(params).length === 0 ? true : undefined;
}

function parseExtensionUpgrade(params: unknown): string[] | undefined {
  if (!isRecord(params)) return undefined;
  const keys = Object.keys(params);
  if (keys.length !== 1) return undefined;
  if (params['all'] === true) return ['extension', 'upgrade', '--all'];
  const name = params['name'];
  return isSafeToken(name) ? ['extension', 'upgrade', name] : undefined;
}

export const COMMANDS: Readonly<Record<string, CommandSpec>> = {
  'gh.version': {
    id: 'gh.version',
    binary: 'gh',
    parseArgs: (params) => (noParams(params) ? ['--version'] : undefined),
    cwd: 'none',
    mode: 'exec',
    mutating: false,
    timeoutMs: 15_000,
    maxOutputBytes: 16 * 1024,
  },
  'gh.extension.upgrade': {
    id: 'gh.extension.upgrade',
    binary: 'gh',
    parseArgs: parseExtensionUpgrade,
    cwd: 'none',
    mode: 'exec',
    mutating: true,
    timeoutMs: 5 * ONE_MINUTE_MS,
    maxOutputBytes: ONE_MEGABYTE,
  },
};
