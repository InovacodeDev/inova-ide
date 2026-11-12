import { isAbsolute } from 'node:path';
import { AccountError, findAccount } from '@inova/core/accounts';
import { PathNotFoundError } from '@inova/core/projects';
import { isProviderId } from '@inova/core/providers';
import { StoreCorruptError } from '@inova/core/store';
import type { Account, ProviderId, Store } from '@inova/core/types';
import type { Result } from '../shared/api.js';

export interface Size {
  cols: number;
  rows: number;
}

const MAX_TEXT = 255;
const MAX_PATH = 4096;
const INVALID: Result<never> = { ok: false, message: 'Entrada inválida.' };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(message: string): Result<never> {
  return { ok: false, message };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value !== '' && value.length <= limit;
}

function isText(value: unknown): value is string {
  return isBoundedString(value, MAX_TEXT);
}

function isPath(value: unknown): value is string {
  return isBoundedString(value, MAX_PATH) && isAbsolute(value);
}

function parseSize(input: Record<string, unknown>): Size | undefined {
  const { cols, rows } = input;
  return typeof cols === 'number' && typeof rows === 'number' ? { cols, rows } : undefined;
}

export function parseNewAccount(
  input: unknown,
): { provider: ProviderId; label: string } | undefined {
  if (!isRecord(input)) return undefined;
  const { provider, label } = input;
  if (!isText(provider) || !isProviderId(provider) || !isText(label)) return undefined;
  return { provider, label };
}

export function parseRemoval(input: unknown): { label: string; force: boolean } | undefined {
  if (!isRecord(input)) return undefined;
  const { label, force } = input;
  return isText(label) && typeof force === 'boolean' ? { label, force } : undefined;
}

export function parsePath(input: unknown): { path: string } | undefined {
  return isRecord(input) && isPath(input['path']) ? { path: input['path'] } : undefined;
}

export function parseBinding(input: unknown): { path: string; accountLabel: string } | undefined {
  if (!isRecord(input)) return undefined;
  const { path, accountLabel } = input;
  return isPath(path) && isText(accountLabel) ? { path, accountLabel } : undefined;
}

export function parseProjectLaunch(input: unknown): ({ projectId: string } & Size) | undefined {
  if (!isRecord(input) || !isText(input['projectId'])) return undefined;
  const size = parseSize(input);
  return size && { projectId: input['projectId'], ...size };
}

export function parseLoginLaunch(input: unknown): ({ accountLabel: string } & Size) | undefined {
  if (!isRecord(input) || !isText(input['accountLabel'])) return undefined;
  const size = parseSize(input);
  return size && { accountLabel: input['accountLabel'], ...size };
}

export function requireAccount(store: Store, label: string): Account {
  const account = findAccount(store, label);
  if (!account) throw new AccountError('not-found', `Conta não encontrada: ${label}.`);
  return account;
}

function accountMessage(error: AccountError, label: string): string {
  switch (error.code) {
    case 'duplicate-label':
      return `Já existe uma conta com o rótulo "${label}".`;
    case 'not-found':
      return `Conta não encontrada: ${label}.`;
    case 'has-projects':
      return 'A conta tem projetos vinculados. Remova com force para desvinculá-los.';
    case 'unsafe-path':
      return 'Caminho da conta inválido; remoção recusada.';
  }
}

export async function guarded<T>(work: () => Promise<Result<T>>, label = ''): Promise<Result<T>> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof AccountError) return fail(accountMessage(error, label));
    if (error instanceof StoreCorruptError)
      return fail(`Arquivo de dados corrompido: ${error.path}.`);
    if (error instanceof PathNotFoundError) return fail(error.message);
    throw error;
  }
}

function labelOf(parsed: unknown): string {
  if (!isRecord(parsed)) return '';
  const label = parsed['label'] ?? parsed['accountLabel'];
  return typeof label === 'string' ? label : '';
}

export function validated<I, T>(
  input: unknown,
  parse: (input: unknown) => I | undefined,
  work: (parsed: I) => Promise<Result<T>>,
): Promise<Result<T>> {
  const parsed = parse(input);
  return parsed === undefined
    ? Promise.resolve(INVALID)
    : guarded(() => work(parsed), labelOf(parsed));
}
