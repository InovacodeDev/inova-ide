import { isAbsolute } from 'node:path';
import { AccountError, findAccount } from '@inova/core/accounts';
import { PathNotFoundError } from '@inova/core/projects';
import { isProviderId } from '@inova/core/providers';
import { SessionError } from '@inova/core/sessions';
import { StoreCorruptError } from '@inova/core/store';
import type { Account, ProviderId, Store } from '@inova/core/types';
import { UsageError } from '@inova/core/usage';
import type { Result } from '../shared/api.js';

export interface Size {
  cols: number;
  rows: number;
}

const MAX_TEXT = 255;
const MAX_PATH = 4096;
const MAX_PROMPT = 100_000;
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

function isSafeId(value: unknown): value is string {
  return (
    isText(value) &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0')
  );
}

export function parseProjectRef(input: unknown): { projectId: string } | undefined {
  return isRecord(input) && isText(input['projectId'])
    ? { projectId: input['projectId'] }
    : undefined;
}

export function parseNewSession(
  input: unknown,
): { projectId: string; parentId: string | null } | undefined {
  if (!isRecord(input) || !isText(input['projectId'])) return undefined;
  const { projectId, parentId = null } = input;
  if (!isText(projectId)) return undefined;
  if (parentId !== null && !isText(parentId)) return undefined;
  return { projectId, parentId };
}

export function parseSessionRef(input: unknown): { sessionId: string } | undefined {
  return isRecord(input) && isSafeId(input['sessionId'])
    ? { sessionId: input['sessionId'] }
    : undefined;
}

export function parseRename(input: unknown): { sessionId: string; title: string } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId']) || !isText(input['title'])) {
    return undefined;
  }
  return { sessionId: input['sessionId'], title: input['title'] };
}

export function parseMessage(input: unknown): { sessionId: string; prompt: string } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const prompt = typeof input['prompt'] === 'string' ? input['prompt'].trim() : '';
  if (prompt === '' || prompt.length > MAX_PROMPT) return undefined;
  return { sessionId: input['sessionId'], prompt };
}

export function parseUsageRequest(input: unknown): { accountLabel: string } | undefined {
  return isRecord(input) && isText(input['accountLabel'])
    ? { accountLabel: input['accountLabel'] }
    : undefined;
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

function sessionMessage(error: SessionError): string {
  switch (error.code) {
    case 'project-not-found':
      return 'Projeto não encontrado.';
    case 'parent-not-found':
      return 'Sessão pai não encontrada.';
    case 'not-found':
      return 'Sessão não encontrada.';
    case 'invalid-title':
      return 'O título deve ter de 1 a 200 caracteres.';
  }
}

function usageMessage(error: UsageError): string {
  switch (error.code) {
    case 'no-credentials':
      return 'Não foi possível ler o consumo: credenciais não encontradas.';
    case 'http':
      return `Não foi possível ler o consumo (HTTP ${error.message.match(/(\d{3})$/)?.[1] ?? '?'}).`;
    case 'bad-response':
      return 'Não foi possível ler o consumo: resposta inválida.';
  }
}

export async function guarded<T>(work: () => Promise<Result<T>>, label = ''): Promise<Result<T>> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof AccountError) return fail(accountMessage(error, label));
    if (error instanceof SessionError) return fail(sessionMessage(error));
    if (error instanceof UsageError) return fail(usageMessage(error));
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
