import { readFileSync } from 'node:fs';
import { AccountError, findAccount } from './core/accounts.js';
import type { LaunchSpec } from './core/launch.js';
import { providers } from './core/providers.js';
import type { CommandRunner } from './core/providers.js';
import { dataRoot, loadStore } from './core/store.js';
import type { Account } from './core/types.js';

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
  runner: CommandRunner;
  spawnInteractive(spec: LaunchSpec): Promise<number | 'not-found'>;
}

export interface Context {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  io: CliIO;
}

export const USAGE = [
  'Uso: inova account add <claude|codex|gemini> <label>',
  'inova account login <label>',
  'inova account list',
  'inova account rm <label> [--force]',
  'inova project bind <label> [path]',
  'inova project unbind [path]',
  'inova project list',
  'inova run [-- args...]',
].join(' | ');

export class UsageError extends Error {}

export function cliVersion(): string {
  const pkgPath = new URL('../package.json', import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    typeof parsed.version === 'string'
  ) {
    return parsed.version;
  }
  return '0.0.0';
}

export function need(value: string | undefined): string {
  if (value === undefined) throw new UsageError(USAGE);
  return value;
}

export function root(ctx: Context): string {
  return dataRoot(ctx.env);
}

export async function requireAccount(ctx: Context, label: string): Promise<Account> {
  const account = findAccount(await loadStore(root(ctx)), label);
  if (!account) throw new AccountError('not-found', `Account not found: ${label}`);
  return account;
}

export async function launch(ctx: Context, spec: LaunchSpec): Promise<number> {
  const result = await ctx.io.spawnInteractive(spec);
  if (result !== 'not-found') return result;
  const adapter = Object.values(providers).find((item) => item.binary === spec.command);
  ctx.io.err(`${spec.command} não encontrado. Instale: ${adapter?.installHint ?? spec.command}`);
  return 127;
}
