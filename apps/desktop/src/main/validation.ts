import { isAbsolute } from 'node:path';
import { AccountError, findAccount } from '@inova/core/accounts';
import { isEffortLevel } from '@inova/core/models';
import { isExecutionMode } from '@inova/core/modes';
import { WorktreeError } from '@inova/core/git-worktree';
import { PathNotFoundError } from '@inova/core/projects';
import { isProviderId } from '@inova/core/providers';
import { SessionError } from '@inova/core/sessions';
import { StoreCorruptError } from '@inova/core/store';
import type {
  Account,
  EffortLevel,
  ExecutionMode,
  ProviderId,
  Store,
  VerificationCheck,
} from '@inova/core/types';
import { UsageError } from '@inova/core/usage';
import type { Result } from '../shared/api.js';

const MAX_TEXT = 255;
const MAX_PATH = 4096;
const MAX_LOGIN_CODE = 512;
const MAX_PROMPT = 100_000;
const MAX_WORKSPACE_INPUT = 1000;
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
): { projectId: string; parentId: string | null; isolatedWorktree?: boolean } | undefined {
  if (!isRecord(input) || !isText(input['projectId'])) return undefined;
  const { projectId, parentId = null, isolatedWorktree } = input;
  if (!isText(projectId)) return undefined;
  if (parentId !== null && !isText(parentId)) return undefined;
  if (isolatedWorktree !== undefined && typeof isolatedWorktree !== 'boolean') return undefined;
  return {
    projectId,
    parentId,
    ...(isolatedWorktree === undefined ? {} : { isolatedWorktree }),
  };
}

export function parseSessionRef(input: unknown): { sessionId: string } | undefined {
  return isRecord(input) && isSafeId(input['sessionId'])
    ? { sessionId: input['sessionId'] }
    : undefined;
}

export function parseSessionDelete(
  input: unknown,
): { sessionId: string; force: boolean } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const { force = false } = input;
  if (typeof force !== 'boolean') return undefined;
  return { sessionId: input['sessionId'], force };
}

export function parseRestoreCheckpoint(
  input: unknown,
): { sessionId: string; ref: string; preserveFiles: string[] } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const { ref, preserveFiles = [] } = input;
  if (!isText(ref) || !ref.startsWith('refs/inova/checkpoints/') || ref.includes('..')) {
    return undefined;
  }
  if (!Array.isArray(preserveFiles) || !preserveFiles.every((f) => isBoundedString(f, MAX_PATH))) {
    return undefined;
  }
  return { sessionId: input['sessionId'], ref, preserveFiles };
}

function isCheckInput(value: unknown): value is VerificationCheck {
  if (!isRecord(value)) return false;
  return (
    isText(value['id']) &&
    isText(value['label']) &&
    isBoundedString(value['command'], 1000) &&
    typeof value['enabled'] === 'boolean'
  );
}

export function parseProjectVerification(input: unknown):
  | {
      projectId: string;
      autoWorktree?: boolean;
      autoVerify?: boolean;
      verificationChecks?: VerificationCheck[];
    }
  | undefined {
  if (!isRecord(input) || !isText(input['projectId'])) return undefined;
  const { projectId, autoWorktree, autoVerify, verificationChecks } = input;
  if (autoWorktree === undefined && autoVerify === undefined && verificationChecks === undefined) {
    return undefined;
  }
  if (autoWorktree !== undefined && typeof autoWorktree !== 'boolean') return undefined;
  if (autoVerify !== undefined && typeof autoVerify !== 'boolean') return undefined;
  if (
    verificationChecks !== undefined &&
    (!Array.isArray(verificationChecks) ||
      verificationChecks.length > 20 ||
      !verificationChecks.every(isCheckInput))
  ) {
    return undefined;
  }
  return {
    projectId,
    ...(autoWorktree === undefined ? {} : { autoWorktree }),
    ...(autoVerify === undefined ? {} : { autoVerify }),
    ...(verificationChecks === undefined ? {} : { verificationChecks }),
  };
}

export interface SessionUpdateInput {
  sessionId: string;
  title?: string;
  archived?: boolean;
  model?: string | null;
  effort?: EffortLevel | null;
  mode?: ExecutionMode | null;
}

export function parseSessionUpdate(input: unknown): SessionUpdateInput | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const { sessionId, title, archived, model, effort, mode } = input;
  if (
    title === undefined &&
    archived === undefined &&
    model === undefined &&
    effort === undefined &&
    mode === undefined
  ) {
    return undefined;
  }
  if (title !== undefined && !isText(title)) return undefined;
  if (archived !== undefined && typeof archived !== 'boolean') return undefined;
  if (model !== undefined && model !== null) {
    if (!isText(model) || model.trim() === '') return undefined;
  }
  if (effort !== undefined && effort !== null && !isEffortLevel(effort)) return undefined;
  if (mode !== undefined && mode !== null && !isExecutionMode(mode)) return undefined;
  return {
    sessionId,
    ...(title === undefined ? {} : { title }),
    ...(archived === undefined ? {} : { archived }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(mode === undefined ? {} : { mode }),
  };
}

export function parseDefaultMode(
  input: unknown,
): { provider: ProviderId; mode: ExecutionMode } | undefined {
  if (!isRecord(input)) return undefined;
  const { provider, mode } = input;
  if (typeof provider !== 'string' || !isProviderId(provider)) return undefined;
  if (!isExecutionMode(mode)) return undefined;
  return { provider, mode };
}

export function parseWorkspace(
  input: unknown,
): { openSessionIds: string[]; activeSessionId: string | null } | undefined {
  if (!isRecord(input)) return undefined;
  const { openSessionIds, activeSessionId } = input;
  if (!Array.isArray(openSessionIds) || openSessionIds.length > MAX_WORKSPACE_INPUT) {
    return undefined;
  }
  if (!openSessionIds.every(isSafeId)) return undefined;
  if (activeSessionId !== null && !isSafeId(activeSessionId)) return undefined;
  return { openSessionIds, activeSessionId };
}

export function parseMessage(input: unknown): { sessionId: string; prompt: string } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const prompt = typeof input['prompt'] === 'string' ? input['prompt'].trim() : '';
  if (prompt === '' || prompt.length > MAX_PROMPT) return undefined;
  return { sessionId: input['sessionId'], prompt };
}

export function parseTurnRef(input: unknown): { turnId: string } | undefined {
  return isRecord(input) && isSafeId(input['turnId']) ? { turnId: input['turnId'] } : undefined;
}

export function parseSwitchAccount(
  input: unknown,
): { sessionId: string; accountId: string; generateHandoff?: boolean } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId']) || !isSafeId(input['accountId'])) {
    return undefined;
  }
  const { generateHandoff } = input;
  if (generateHandoff !== undefined && typeof generateHandoff !== 'boolean') return undefined;
  return {
    sessionId: input['sessionId'],
    accountId: input['accountId'],
    ...(generateHandoff === undefined ? {} : { generateHandoff }),
  };
}

export function parseHandoffSession(
  input: unknown,
): { sessionId: string; targetAccountId: string; createWorktree?: boolean } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId']) || !isSafeId(input['targetAccountId'])) {
    return undefined;
  }
  const { createWorktree } = input;
  if (createWorktree !== undefined && typeof createWorktree !== 'boolean') return undefined;
  return {
    sessionId: input['sessionId'],
    targetAccountId: input['targetAccountId'],
    ...(createWorktree === undefined ? {} : { createWorktree }),
  };
}

export function parseForkSession(
  input: unknown,
):
  | { sessionId: string; turnIndex: number; targetAccountId?: string; copyWorktreeFiles?: boolean }
  | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const { turnIndex, targetAccountId, copyWorktreeFiles } = input;
  if (typeof turnIndex !== 'number' || !Number.isInteger(turnIndex) || turnIndex < 0) {
    return undefined;
  }
  if (targetAccountId !== undefined && !isSafeId(targetAccountId)) return undefined;
  if (copyWorktreeFiles !== undefined && typeof copyWorktreeFiles !== 'boolean') return undefined;
  return {
    sessionId: input['sessionId'],
    turnIndex,
    ...(targetAccountId === undefined ? {} : { targetAccountId }),
    ...(copyWorktreeFiles === undefined ? {} : { copyWorktreeFiles }),
  };
}

export function parseUiFocus(
  input: unknown,
): { activeSessionId: string | null; windowFocused: boolean } | undefined {
  if (!isRecord(input)) return undefined;
  const { activeSessionId, windowFocused } = input;
  if (typeof windowFocused !== 'boolean') return undefined;
  if (activeSessionId !== null && !isSafeId(activeSessionId)) return undefined;
  return { activeSessionId, windowFocused };
}

function parseOptionalModel(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > 200 ? undefined : trimmed;
}

function parseOptionalEffort(value: unknown): EffortLevel | null | undefined {
  if (value === undefined || value === null) return value;
  return isEffortLevel(value) ? value : undefined;
}

function parseOptionalMode(value: unknown): ExecutionMode | null | undefined {
  if (value === undefined || value === null) return value;
  return isExecutionMode(value) ? value : undefined;
}

export function parseStartComparison(input: unknown):
  | {
      projectId: string;
      prompt: string;
      leftAccountId: string;
      rightAccountId: string;
      leftModel?: string | null;
      leftEffort?: EffortLevel | null;
      leftMode?: ExecutionMode | null;
      rightModel?: string | null;
      rightEffort?: EffortLevel | null;
      rightMode?: ExecutionMode | null;
    }
  | undefined {
  if (
    !isRecord(input) ||
    !isSafeId(input['projectId']) ||
    !isSafeId(input['leftAccountId']) ||
    !isSafeId(input['rightAccountId'])
  ) {
    return undefined;
  }
  const prompt = typeof input['prompt'] === 'string' ? input['prompt'].trim() : '';
  if (prompt === '' || prompt.length > MAX_PROMPT) return undefined;
  const leftModel = parseOptionalModel(input['leftModel']);
  const rightModel = parseOptionalModel(input['rightModel']);
  const leftEffort = parseOptionalEffort(input['leftEffort']);
  const rightEffort = parseOptionalEffort(input['rightEffort']);
  const leftMode = parseOptionalMode(input['leftMode']);
  const rightMode = parseOptionalMode(input['rightMode']);
  if (
    (input['leftModel'] !== undefined && leftModel === undefined) ||
    (input['rightModel'] !== undefined && rightModel === undefined) ||
    (input['leftEffort'] !== undefined && leftEffort === undefined) ||
    (input['rightEffort'] !== undefined && rightEffort === undefined) ||
    (input['leftMode'] !== undefined && leftMode === undefined) ||
    (input['rightMode'] !== undefined && rightMode === undefined)
  ) {
    return undefined;
  }
  return {
    projectId: input['projectId'],
    prompt,
    leftAccountId: input['leftAccountId'],
    rightAccountId: input['rightAccountId'],
    ...(leftModel === undefined ? {} : { leftModel }),
    ...(leftEffort === undefined ? {} : { leftEffort }),
    ...(leftMode === undefined ? {} : { leftMode }),
    ...(rightModel === undefined ? {} : { rightModel }),
    ...(rightEffort === undefined ? {} : { rightEffort }),
    ...(rightMode === undefined ? {} : { rightMode }),
  };
}

export function parseComparisonRef(input: unknown): { groupId: string } | undefined {
  return isRecord(input) && isSafeId(input['groupId']) ? { groupId: input['groupId'] } : undefined;
}

export function parseResolveComparison(
  input: unknown,
): { groupId: string; winner: 'left' | 'right'; cleanupWorktrees?: boolean } | undefined {
  if (!isRecord(input) || !isSafeId(input['groupId'])) return undefined;
  const { winner, cleanupWorktrees } = input;
  if (winner !== 'left' && winner !== 'right') return undefined;
  if (cleanupWorktrees !== undefined && typeof cleanupWorktrees !== 'boolean') return undefined;
  return {
    groupId: input['groupId'],
    winner,
    ...(cleanupWorktrees === undefined ? {} : { cleanupWorktrees }),
  };
}

function isRulesFile(value: unknown): value is 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md' {
  return value === 'AGENTS.md' || value === 'CLAUDE.md' || value === 'GEMINI.md';
}

export function parsePreviewProfileSync(input: unknown):
  | {
      projectId: string;
      accountIds?: string[];
      rulesSource?: 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md' | null;
    }
  | undefined {
  if (!isRecord(input) || !isSafeId(input['projectId'])) return undefined;
  const { accountIds, rulesSource } = input;
  if (
    accountIds !== undefined &&
    (!Array.isArray(accountIds) || accountIds.length > 50 || !accountIds.every(isSafeId))
  ) {
    return undefined;
  }
  if (rulesSource !== undefined && rulesSource !== null && !isRulesFile(rulesSource)) {
    return undefined;
  }
  return {
    projectId: input['projectId'],
    ...(accountIds === undefined ? {} : { accountIds }),
    ...(rulesSource === undefined ? {} : { rulesSource }),
  };
}

export function parseApplyProfileSync(input: unknown):
  | {
      projectId: string;
      accountIds?: string[];
      rulesSource?: 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md' | null;
      approvedIds: string[];
      rulesStrategy?: 'copy' | 'symlink';
    }
  | undefined {
  const base = parsePreviewProfileSync(input);
  if (!base || !isRecord(input)) return undefined;
  const { approvedIds, rulesStrategy } = input;
  if (
    !Array.isArray(approvedIds) ||
    approvedIds.length > 100 ||
    !approvedIds.every((id) => typeof id === 'string' && id.trim() !== '' && id.length <= 200)
  ) {
    return undefined;
  }
  if (rulesStrategy !== undefined && rulesStrategy !== 'copy' && rulesStrategy !== 'symlink') {
    return undefined;
  }
  return {
    ...base,
    approvedIds,
    ...(rulesStrategy === undefined ? {} : { rulesStrategy }),
  };
}

export function parseUsageRequest(input: unknown): { accountLabel: string } | undefined {
  return isRecord(input) && isText(input['accountLabel'])
    ? { accountLabel: input['accountLabel'] }
    : undefined;
}

const DEFAULT_FILE_SEARCH_LIMIT = 40;
const MAX_FILE_SEARCH_LIMIT = 100;

export function parseFileSearch(
  input: unknown,
): { projectId: string; query: string; limit: number; sessionId?: string } | undefined {
  if (!isRecord(input) || !isText(input['projectId'])) return undefined;
  const { query, limit = DEFAULT_FILE_SEARCH_LIMIT, sessionId } = input;
  if (typeof query !== 'string' || query.length > MAX_TEXT) return undefined;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_FILE_SEARCH_LIMIT
  ) {
    return undefined;
  }
  if (sessionId !== undefined && !isSafeId(sessionId)) return undefined;
  return {
    projectId: input['projectId'],
    query,
    limit,
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

export function parseLoginCode(input: unknown): { sessionId: string; code: string } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const code = typeof input['code'] === 'string' ? input['code'].trim() : '';
  if (code === '' || code.length > MAX_LOGIN_CODE) return undefined;
  return { sessionId: input['sessionId'], code };
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
    case 'invalid-model':
      return 'O modelo deve ter de 1 a 200 caracteres.';
    case 'invalid-effort':
      return 'Nível de esforço inválido.';
    case 'invalid-mode':
      return 'Modo não suportado por este provedor.';
    case 'invalid-workspace':
      return 'Área de trabalho inválida.';
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
    if (error instanceof WorktreeError) return fail(error.message);
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
