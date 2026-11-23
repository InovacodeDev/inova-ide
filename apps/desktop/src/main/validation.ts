import { isAbsolute } from 'node:path';
import { AccountError, findAccount } from '@inova/core/accounts';
import { isCapabilityRef } from '@inova/core/capabilities/types';
import type { CapabilityKind } from '@inova/core/capabilities/types';
import { MAX_PINNED_MEMORY_CHARS } from '@inova/core/handoff';
import { isLibraryId } from '@inova/core/library/index';
import type { LibraryItemKind } from '@inova/core/library/index';
import { isEffortLevel } from '@inova/core/models';
import { isExecutionMode } from '@inova/core/modes';
import { isValidOrchestratorRounds } from '@inova/core/orchestrator';
import { WorktreeError } from '@inova/core/git-worktree';
import { PathNotFoundError } from '@inova/core/projects';
import { isProviderId } from '@inova/core/providers';
import {
  SessionImportError,
  isExternalSessionId,
  isImportProvider,
} from '@inova/core/session-import';
import type { ImportProvider } from '@inova/core/session-import';
import { SessionError } from '@inova/core/sessions';
import { SettingsError, isSettingsPatch } from '@inova/core/settings';
import { StoreCorruptError } from '@inova/core/store';
import type {
  Account,
  EffortLevel,
  ExecutionMode,
  ProviderId,
  SessionOrchestratorConfig,
  SettingsPatch,
  Store,
  VerificationCheck,
} from '@inova/core/types';
import { UsageError } from '@inova/core/usage';
import { ATTACHMENT_KINDS, SESSION_EXPIRED_USAGE_MESSAGE } from '../shared/api.js';
import type {
  AttachmentKind,
  FilePreviewSource,
  OpenFilePathInput,
  ReadFilePreviewInput,
  Result,
  RunCommandInput,
} from '../shared/api.js';

const MAX_TEXT = 255;
const MAX_PATH = 4096;
const MAX_LOGIN_CODE = 512;
const MAX_PROMPT = 100_000;
const MAX_EXTRA_DIRS = 16;
const MAX_WORKSPACE_INPUT = 1000;
const MAX_IMPORT_SESSIONS = 50;
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

function isPinnedMemoryInput(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' && value.length <= MAX_PINNED_MEMORY_CHARS && !value.includes('\0'))
  );
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

export function parseAttachmentPick(input: unknown): { kind: AttachmentKind } | undefined {
  if (!isRecord(input)) return undefined;
  const kind = ATTACHMENT_KINDS.find((candidate) => candidate === input['kind']);
  return kind === undefined ? undefined : { kind };
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

function isFilePreviewSource(value: unknown): value is FilePreviewSource {
  return value === 'project' || value === 'user-drop' || value === 'picker';
}

function parseFilePreviewInput(
  input: unknown,
): { path: string; source: FilePreviewSource; projectId?: string; sessionId?: string } | undefined {
  if (!isRecord(input)) return undefined;
  const { path, source, projectId, sessionId } = input;
  if (!isFilePreviewSource(source)) return undefined;
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > MAX_PATH ||
    path.includes('\0')
  ) {
    return undefined;
  }
  if (source !== 'project' && !isAbsolute(path)) {
    return undefined;
  }
  if (projectId !== undefined && !isSafeId(projectId)) {
    return undefined;
  }
  if (sessionId !== undefined && !isSafeId(sessionId)) {
    return undefined;
  }
  return {
    path,
    source,
    ...(projectId === undefined ? {} : { projectId }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

export function parseReadFilePreview(input: unknown): ReadFilePreviewInput | undefined {
  return parseFilePreviewInput(input);
}

export function parseOpenFilePath(input: unknown): OpenFilePathInput | undefined {
  return parseFilePreviewInput(input);
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

export function parseClearSession(
  input: unknown,
): { sessionId: string; keepContext: boolean } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const { keepContext = false } = input;
  if (typeof keepContext !== 'boolean') return undefined;
  return { sessionId: input['sessionId'], keepContext };
}

export function parseSessionDelete(
  input: unknown,
): { sessionId: string; force: boolean } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const { force = false } = input;
  if (typeof force !== 'boolean') return undefined;
  return { sessionId: input['sessionId'], force };
}

function isRelativeRepoPath(value: unknown): value is string {
  if (!isBoundedString(value, MAX_PATH) || isAbsolute(value)) return false;
  if (value.includes('\0') || value.includes('\\')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function parseRestoreCheckpoint(input: unknown):
  | {
      sessionId: string;
      ref?: string;
      preserveFiles: string[];
      files?: string[];
    }
  | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const { ref, preserveFiles = [], files } = input;
  if (ref === undefined && files === undefined) return undefined;
  if (ref !== undefined) {
    if (!isText(ref) || !ref.startsWith('refs/inova/checkpoints/') || ref.includes('..')) {
      return undefined;
    }
  }
  if (!Array.isArray(preserveFiles) || !preserveFiles.every((f) => isBoundedString(f, MAX_PATH))) {
    return undefined;
  }
  if (files !== undefined) {
    if (!Array.isArray(files) || files.length === 0 || files.length > 200) return undefined;
    if (!files.every(isRelativeRepoPath)) return undefined;
  }
  return {
    sessionId: input['sessionId'],
    ...(ref === undefined ? {} : { ref }),
    preserveFiles,
    ...(files === undefined ? {} : { files }),
  };
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
      pinnedMemory?: string | null;
    }
  | undefined {
  if (!isRecord(input) || !isText(input['projectId'])) return undefined;
  const { projectId, autoWorktree, autoVerify, verificationChecks, pinnedMemory } = input;
  if (
    autoWorktree === undefined &&
    autoVerify === undefined &&
    verificationChecks === undefined &&
    pinnedMemory === undefined
  ) {
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
  if (pinnedMemory !== undefined && !isPinnedMemoryInput(pinnedMemory)) return undefined;
  return {
    projectId,
    ...(autoWorktree === undefined ? {} : { autoWorktree }),
    ...(autoVerify === undefined ? {} : { autoVerify }),
    ...(verificationChecks === undefined ? {} : { verificationChecks }),
    ...(pinnedMemory === undefined ? {} : { pinnedMemory }),
  };
}

export interface SessionUpdateInput {
  sessionId: string;
  title?: string;
  archived?: boolean;
  model?: string | null;
  effort?: EffortLevel | null;
  mode?: ExecutionMode | null;
  pinnedMemory?: string | null;
  orchestrator?: SessionOrchestratorConfig | null;
}

function isOrchestratorInput(value: unknown): value is SessionOrchestratorConfig {
  if (!isRecord(value)) return false;
  const { enabled, accountId, model, effort, maxRounds, providerSessionId } = value;
  if (typeof enabled !== 'boolean') return false;
  if (!isSafeId(accountId)) return false;
  if (model !== null && (!isText(model) || model.trim() === '')) return false;
  if (effort !== undefined && effort !== null && !isEffortLevel(effort)) return false;
  if (maxRounds !== undefined && !isValidOrchestratorRounds(maxRounds)) return false;
  if (
    providerSessionId !== undefined &&
    providerSessionId !== null &&
    !isBoundedString(providerSessionId, MAX_TEXT)
  ) {
    return false;
  }
  return true;
}

export function parseSessionUpdate(input: unknown): SessionUpdateInput | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const { sessionId, title, archived, model, effort, mode, pinnedMemory, orchestrator } = input;
  if (
    title === undefined &&
    archived === undefined &&
    model === undefined &&
    effort === undefined &&
    mode === undefined &&
    pinnedMemory === undefined &&
    orchestrator === undefined
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
  if (pinnedMemory !== undefined && !isPinnedMemoryInput(pinnedMemory)) return undefined;
  if (orchestrator !== undefined && orchestrator !== null && !isOrchestratorInput(orchestrator)) {
    return undefined;
  }
  return {
    sessionId,
    ...(title === undefined ? {} : { title }),
    ...(archived === undefined ? {} : { archived }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(mode === undefined ? {} : { mode }),
    ...(pinnedMemory === undefined ? {} : { pinnedMemory }),
    ...(orchestrator === undefined ? {} : { orchestrator }),
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

export function parseSettingsPatch(input: unknown): SettingsPatch | undefined {
  return isSettingsPatch(input) ? input : undefined;
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

export function parseMessage(
  input: unknown,
): { sessionId: string; prompt: string; extraDirs: string[] } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const prompt = typeof input['prompt'] === 'string' ? input['prompt'].trim() : '';
  if (prompt === '' || prompt.length > MAX_PROMPT) return undefined;
  const rawDirs: unknown = input['extraDirs'] ?? [];
  if (!Array.isArray(rawDirs) || rawDirs.length > MAX_EXTRA_DIRS) return undefined;
  const extraDirs = rawDirs.filter((dir): dir is string => isPath(dir) && !dir.includes('\0'));
  if (extraDirs.length !== rawDirs.length) return undefined;
  return { sessionId: input['sessionId'], prompt, extraDirs };
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

export function parseRewindSession(
  input: unknown,
): { sessionId: string; turnIndex: number } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const { turnIndex } = input;
  if (typeof turnIndex !== 'number' || !Number.isInteger(turnIndex) || turnIndex < 0) {
    return undefined;
  }
  return { sessionId: input['sessionId'], turnIndex };
}

export function parseRecordFeedback(
  input: unknown,
): { sessionId: string; turnIndex: number; value: 'up' | 'down' | null } | undefined {
  if (!isRecord(input) || !isSafeId(input['sessionId'])) return undefined;
  const { turnIndex, value } = input;
  if (typeof turnIndex !== 'number' || !Number.isInteger(turnIndex) || turnIndex < 0) {
    return undefined;
  }
  if (value !== 'up' && value !== 'down' && value !== null) return undefined;
  return { sessionId: input['sessionId'], turnIndex, value };
}

export function parseImportSessions(
  input: unknown,
):
  | { projectId: string; provider: ImportProvider; accountId: string; sessionIds: string[] }
  | undefined {
  if (!isRecord(input)) return undefined;
  const { projectId, provider, accountId, sessionIds } = input;
  if (!isText(projectId) || !isImportProvider(provider) || !isSafeId(accountId)) return undefined;
  if (
    !Array.isArray(sessionIds) ||
    sessionIds.length === 0 ||
    sessionIds.length > MAX_IMPORT_SESSIONS ||
    !sessionIds.every(isExternalSessionId) ||
    new Set(sessionIds).size !== sessionIds.length
  ) {
    return undefined;
  }
  return { projectId, provider, accountId, sessionIds };
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
      sourceAccountId?: string | null;
    }
  | undefined {
  if (!isRecord(input) || !isSafeId(input['projectId'])) return undefined;
  const { accountIds, rulesSource, sourceAccountId } = input;
  if (
    accountIds !== undefined &&
    (!Array.isArray(accountIds) || accountIds.length > 50 || !accountIds.every(isSafeId))
  ) {
    return undefined;
  }
  if (rulesSource !== undefined && rulesSource !== null && !isRulesFile(rulesSource)) {
    return undefined;
  }
  if (sourceAccountId !== undefined && sourceAccountId !== null && !isSafeId(sourceAccountId)) {
    return undefined;
  }
  return {
    projectId: input['projectId'],
    ...(accountIds === undefined ? {} : { accountIds }),
    ...(rulesSource === undefined ? {} : { rulesSource }),
    ...(sourceAccountId === undefined ? {} : { sourceAccountId }),
  };
}

export function parseApplyProfileSync(input: unknown):
  | {
      projectId: string;
      accountIds?: string[];
      rulesSource?: 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md' | null;
      sourceAccountId?: string | null;
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

export function parseCapabilityList(input: unknown): { accountLabel: string } | undefined {
  return parseUsageRequest(input);
}

export function parseCapabilityToggle(
  input: unknown,
): { accountLabel: string; kind: CapabilityKind; id: string; enabled: boolean } | undefined {
  if (!isRecord(input) || !isText(input['accountLabel'])) return undefined;
  const ref: unknown = { kind: input['kind'], id: input['id'] };
  const enabled = input['enabled'];
  if (!isCapabilityRef(ref) || typeof enabled !== 'boolean') return undefined;
  return { accountLabel: input['accountLabel'], kind: ref.kind, id: ref.id, enabled };
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

const MAX_COMMAND_PARAMS_JSON = 4096;

function isBoundedJson(value: unknown): boolean {
  if (value === undefined) return true;
  try {
    const json = JSON.stringify(value);
    return json !== undefined && json.length <= MAX_COMMAND_PARAMS_JSON;
  } catch {
    return false;
  }
}

export function parseRunCommand(input: unknown): RunCommandInput | undefined {
  if (!isRecord(input)) return undefined;
  const { commandId, params, projectId, accountId } = input;
  if (!isText(commandId) || !isBoundedJson(params)) return undefined;
  if (projectId !== undefined && !isSafeId(projectId)) return undefined;
  if (accountId !== undefined && !isSafeId(accountId)) return undefined;
  return {
    commandId,
    ...(params === undefined ? {} : { params }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(accountId === undefined ? {} : { accountId }),
  };
}

export function parseConfirmCommand(input: unknown): { confirmationId: string } | undefined {
  return isRecord(input) && isSafeId(input['confirmationId'])
    ? { confirmationId: input['confirmationId'] }
    : undefined;
}

export function parseCommandRunId(input: unknown): string | undefined {
  return isSafeId(input) ? input : undefined;
}

const MAX_LIBRARY_NAME = 100;
const MAX_LIBRARY_DESCRIPTION = 500;
const MAX_LIBRARY_SKILL_CONTENT = 262_144;
const MAX_LIBRARY_DEFINITION_ENTRIES = 100;
const MAX_LIBRARY_DEFINITION_DEPTH = 5;
const MAX_LIBRARY_DEFINITION_NODES = 1000;
const MAX_LIBRARY_DEFINITION_TEXT = 2048;
const MAX_SYNC_ACCOUNTS = 50;
const MAX_APPROVED_IDS = 200;
const MAX_APPROVED_ID_LENGTH = 300;

const LIBRARY_ITEM_COMMON_KEYS = ['id', 'name', 'description', 'enabled', 'kind'];
const LIBRARY_ITEM_KIND_KEYS: Record<LibraryItemKind, string[]> = {
  skill: ['content'],
  mcp: ['definition'],
  connector: ['definition', 'label'],
  plugin: ['definition'],
};

export interface ParsedSaveLibraryItem {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  kind: LibraryItemKind;
  content?: string;
  definition?: unknown;
  label?: string;
}

export interface ParsedLibrarySyncSelection {
  projectId: string;
  accountIds?: string[];
}

function hasOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(input).every((key) => allowed.includes(key));
}

function isLibraryKind(value: unknown): value is LibraryItemKind {
  return typeof value === 'string' && Object.hasOwn(LIBRARY_ITEM_KIND_KEYS, value);
}

function isBoundedDefinition(definition: unknown): boolean {
  let nodes = 0;
  const visit = (value: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > MAX_LIBRARY_DEFINITION_NODES || depth > MAX_LIBRARY_DEFINITION_DEPTH) return false;
    if (typeof value === 'string') return value.length <= MAX_LIBRARY_DEFINITION_TEXT;
    if (Array.isArray(value)) {
      return (
        value.length <= MAX_LIBRARY_DEFINITION_ENTRIES &&
        value.every((entry: unknown) => visit(entry, depth + 1))
      );
    }
    if (!isRecord(value)) return true;
    const keys = Object.keys(value);
    return (
      keys.length <= MAX_LIBRARY_DEFINITION_ENTRIES &&
      keys.every((key) => key.length <= MAX_LIBRARY_DEFINITION_TEXT && visit(value[key], depth + 1))
    );
  };
  return isRecord(definition) && visit(definition, 1);
}

function isLibraryLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_LIBRARY_NAME;
}

function parseLibraryKindFields(input: {
  kind: LibraryItemKind;
  raw: Record<string, unknown>;
}): Pick<ParsedSaveLibraryItem, 'content' | 'definition' | 'label'> | undefined {
  const { kind, raw } = input;
  switch (kind) {
    case 'skill': {
      const content = raw['content'];
      if (content === undefined) return {};
      const valid = typeof content === 'string' && content.length <= MAX_LIBRARY_SKILL_CONTENT;
      return valid ? { content } : undefined;
    }
    case 'connector': {
      const label = raw['label'];
      const valid = isLibraryLabel(label) && isBoundedDefinition(raw['definition']);
      return valid ? { definition: raw['definition'], label } : undefined;
    }
    case 'mcp':
    case 'plugin':
      return isBoundedDefinition(raw['definition']) ? { definition: raw['definition'] } : undefined;
  }
}

export function parseSaveLibraryItem(input: unknown): ParsedSaveLibraryItem | undefined {
  if (!isRecord(input)) return undefined;
  const { id, name, description, enabled, kind } = input;
  if (!isLibraryId(id) || !isLibraryKind(kind) || typeof enabled !== 'boolean') return undefined;
  if (typeof name !== 'string' || name.length > MAX_LIBRARY_NAME) return undefined;
  const validDescription =
    description === null ||
    (typeof description === 'string' && description.length <= MAX_LIBRARY_DESCRIPTION);
  if (!validDescription) return undefined;
  if (!hasOnlyKeys(input, [...LIBRARY_ITEM_COMMON_KEYS, ...LIBRARY_ITEM_KIND_KEYS[kind]])) {
    return undefined;
  }
  const fields = parseLibraryKindFields({ kind, raw: input });
  return fields === undefined ? undefined : { id, name, description, enabled, kind, ...fields };
}

export function parseRemoveLibraryItem(input: unknown): { id: string } | undefined {
  if (!isRecord(input) || !hasOnlyKeys(input, ['id']) || !isSafeId(input['id'])) {
    return undefined;
  }
  return { id: input['id'] };
}

export function parseSetProjectOverride(
  input: unknown,
): { projectId: string; itemId: string; disabled: boolean } | undefined {
  if (!isRecord(input) || !hasOnlyKeys(input, ['projectId', 'itemId', 'disabled'])) {
    return undefined;
  }
  const { projectId, itemId, disabled } = input;
  if (!isSafeId(projectId) || !isLibraryId(itemId) || typeof disabled !== 'boolean') {
    return undefined;
  }
  return { projectId, itemId, disabled };
}

function parseLibrarySyncSelection(
  input: Record<string, unknown>,
): ParsedLibrarySyncSelection | undefined {
  const { projectId, accountIds } = input;
  if (!isSafeId(projectId)) return undefined;
  if (accountIds === undefined) return { projectId };
  if (!Array.isArray(accountIds) || accountIds.length > MAX_SYNC_ACCOUNTS) return undefined;
  return accountIds.every(isSafeId) ? { projectId, accountIds } : undefined;
}

export function parsePreviewLibrarySync(input: unknown): ParsedLibrarySyncSelection | undefined {
  if (!isRecord(input) || !hasOnlyKeys(input, ['projectId', 'accountIds'])) return undefined;
  return parseLibrarySyncSelection(input);
}

export function parseApplyLibrarySync(
  input: unknown,
): (ParsedLibrarySyncSelection & { approvedIds: string[] }) | undefined {
  if (!isRecord(input) || !hasOnlyKeys(input, ['projectId', 'accountIds', 'approvedIds'])) {
    return undefined;
  }
  const selection = parseLibrarySyncSelection(input);
  const { approvedIds } = input;
  if (!selection || !Array.isArray(approvedIds) || approvedIds.length > MAX_APPROVED_IDS) {
    return undefined;
  }
  const valid = approvedIds.every(
    (id: unknown): id is string =>
      typeof id === 'string' && id !== '' && id.length <= MAX_APPROVED_ID_LENGTH,
  );
  return valid ? { ...selection, approvedIds } : undefined;
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
    case 'invalid-pinned-memory':
      return `A memória fixada deve ter no máximo ${MAX_PINNED_MEMORY_CHARS} caracteres.`;
    case 'invalid-orchestrator':
      return 'Configuração do orquestrador inválida.';
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
    case 'unauthorized':
      return SESSION_EXPIRED_USAGE_MESSAGE;
    case 'rate-limited':
      return 'Limite de consultas de consumo atingido. O app tenta de novo em alguns minutos.';
    case 'token-expired':
      return 'Não foi possível renovar o token da conta. O app tenta de novo na próxima atualização.';
  }
}

export async function guarded<T>(work: () => Promise<Result<T>>, label = ''): Promise<Result<T>> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof AccountError) return fail(accountMessage(error, label));
    if (error instanceof SessionError) return fail(sessionMessage(error));
    if (error instanceof SettingsError) return fail('Configurações inválidas.');
    if (error instanceof WorktreeError) return fail(error.message);
    if (error instanceof SessionImportError) return fail(error.message);
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
