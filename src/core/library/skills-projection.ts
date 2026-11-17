import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serialize } from '../capabilities/file-edit.js';
import type {
  ProfileSyncAccountInput,
  ProfileSyncItem,
  ProfileSyncLibraryInput,
  ProfileSyncStatus,
} from '../profile-sync.js';
import type { ProviderId } from '../types.js';
import { resolveEffectiveItems } from './effective.js';
import {
  backupEntry,
  copySkillDir,
  hashSkillDir,
  lstatIfExists,
  readLibrarySkillHash,
  removeEntry,
  replaceEntry,
  SKILL_MARKER_FILE,
  SkillValidationError,
  temporaryEntryName,
} from './skills.js';
import { skillDir } from './store.js';

const MANAGED_BY = 'inova-ide';
const MAX_MARKER_BYTES = 4096;
const SKILL_FOLDER_PROVIDERS: ReadonlySet<ProviderId> = new Set(['claude', 'codex']);
const UNSUPPORTED_REASONS: Partial<Record<ProviderId, string>> = {
  gemini: 'Skills do Gemini só via plugin.',
  opencode: 'Pasta de skills do OpenCode fica fora da conta (v1).',
  deepseek: 'DeepSeek sem suporte a skills.',
};
const UNVERIFIED_REASON = 'Pasta de skills deste provider não verificada.';

export interface SkillPlanEntry {
  item: ProfileSyncItem;
  accountId: string;
  skillId: string;
  skillsDir: string;
  targetDir: string;
  libraryHash: string | null;
}

interface ItemFacts {
  status: ProfileSyncStatus;
  reason?: string;
  before?: string;
  after?: string;
}

type TargetState =
  | { kind: 'missing' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'foreign'; reason: string }
  | { kind: 'managed'; hash: string };

type LibraryHash = { hash: string } | { reason: string };

export type SkillApplyOutcome = 'applied' | 'skipped';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function skillsDirOf(account: ProfileSyncAccountInput): string {
  return join(account.homeDir, 'skills');
}

function describeHash(hash: string): string {
  return `skill (hash ${hash.slice(0, 12)})`;
}

async function readMarker(input: { dir: string; id: string }): Promise<{ hash: string } | null> {
  const file = join(input.dir, SKILL_MARKER_FILE);
  const stats = await lstatIfExists(file);
  if (!stats || !stats.isFile() || stats.size > MAX_MARKER_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['managedBy'] !== MANAGED_BY || parsed['id'] !== input.id) {
    return null;
  }
  const hash = parsed['hash'];
  return typeof hash === 'string' ? { hash } : null;
}

async function inspectTarget(input: { skillsDir: string; skillId: string }): Promise<TargetState> {
  const { skillsDir, skillId } = input;
  const parent = await lstatIfExists(skillsDir);
  if (parent && !parent.isDirectory()) {
    return { kind: 'blocked', reason: 'Pasta de skills da conta é um link ou não é uma pasta.' };
  }
  const targetDir = join(skillsDir, skillId);
  const target = await lstatIfExists(targetDir);
  if (!target) return { kind: 'missing' };
  if (!target.isDirectory()) {
    return { kind: 'foreign', reason: 'Entrada existente não é uma pasta da IDE.' };
  }
  const marker = await readMarker({ dir: targetDir, id: skillId });
  if (!marker) return { kind: 'foreign', reason: 'Pasta existente sem marcador da IDE.' };
  return { kind: 'managed', hash: marker.hash };
}

async function loadLibraryHash(input: { root: string; skillId: string }): Promise<LibraryHash> {
  try {
    return { hash: await readLibrarySkillHash(skillDir(input.root, input.skillId)) };
  } catch (error: unknown) {
    if (error instanceof SkillValidationError) {
      return { reason: `Pasta da skill na biblioteca ausente ou inválida: ${error.message}` };
    }
    throw error;
  }
}

function buildEntry(input: {
  account: ProfileSyncAccountInput;
  skillId: string;
  libraryHash: string | null;
  facts: ItemFacts;
}): SkillPlanEntry {
  const { account, skillId, libraryHash, facts } = input;
  const skillsDir = skillsDirOf(account);
  const targetDir = join(skillsDir, skillId);
  const item: ProfileSyncItem = {
    id: skillId === '' ? `skill:${account.id}` : `skill:${account.id}:${skillId}`,
    scope: 'skill',
    provider: account.provider,
    accountId: account.id,
    accountLabel: account.label,
    targetPath: targetDir,
    status: facts.status,
    ...(facts.reason ? { reason: facts.reason } : {}),
    maskedBefore: facts.before ?? '',
    maskedAfter: facts.after ?? '',
  };
  return { item, accountId: account.id, skillId, skillsDir, targetDir, libraryHash };
}

function projectionFacts(input: { state: TargetState; libraryHash: string }): ItemFacts {
  const { state, libraryHash } = input;
  const after = describeHash(libraryHash);
  if (state.kind === 'missing') return { status: 'create', after };
  if (state.kind === 'managed') {
    const status = state.hash === libraryHash ? 'unchanged' : 'update';
    return { status, before: describeHash(state.hash), after };
  }
  return { status: 'conflict', reason: state.reason, after };
}

async function planSkill(input: {
  root: string;
  account: ProfileSyncAccountInput;
  skillId: string;
  hashes: Map<string, LibraryHash>;
}): Promise<SkillPlanEntry> {
  const { root, account, skillId, hashes } = input;
  const library = hashes.get(skillId) ?? (await loadLibraryHash({ root, skillId }));
  hashes.set(skillId, library);
  if ('reason' in library) {
    const facts: ItemFacts = { status: 'incompatible', reason: library.reason };
    return buildEntry({ account, skillId, libraryHash: null, facts });
  }
  const state = await inspectTarget({ skillsDir: skillsDirOf(account), skillId });
  const facts = projectionFacts({ state, libraryHash: library.hash });
  return buildEntry({ account, skillId, libraryHash: library.hash, facts });
}

async function listAccountFolders(skillsDir: string): Promise<string[]> {
  const stats = await lstatIfExists(skillsDir);
  if (!stats || !stats.isDirectory()) return [];
  return (await readdir(skillsDir)).sort();
}

async function planRemovals(input: {
  account: ProfileSyncAccountInput;
  retainedIds: ReadonlySet<string>;
}): Promise<SkillPlanEntry[]> {
  const { account, retainedIds } = input;
  const skillsDir = skillsDirOf(account);
  const entries: SkillPlanEntry[] = [];
  for (const skillId of await listAccountFolders(skillsDir)) {
    if (retainedIds.has(skillId)) continue;
    const state = await inspectTarget({ skillsDir, skillId });
    if (state.kind !== 'managed') continue;
    const facts: ItemFacts = { status: 'remove', before: describeHash(state.hash) };
    entries.push(buildEntry({ account, skillId, libraryHash: null, facts }));
  }
  return entries;
}

function skillIds(items: readonly { kind: string; id: string }[]): string[] {
  return items.filter((item) => item.kind === 'skill').map((item) => item.id);
}

function unsupportedEntry(account: ProfileSyncAccountInput): SkillPlanEntry {
  const reason = UNSUPPORTED_REASONS[account.provider] ?? UNVERIFIED_REASON;
  return buildEntry({
    account,
    skillId: '',
    libraryHash: null,
    facts: { status: 'incompatible', reason },
  });
}

async function planAccountSkills(input: {
  root: string;
  account: ProfileSyncAccountInput;
  library: ProfileSyncLibraryInput;
  hashes: Map<string, LibraryHash>;
}): Promise<SkillPlanEntry[]> {
  const { root, account, library, hashes } = input;
  const accountDisabled = account.disabledCapabilities ?? [];
  const effectiveIds = skillIds(
    resolveEffectiveItems({
      items: library.items,
      projectDisabled: library.projectDisabled,
      accountDisabled,
    }),
  );
  if (!SKILL_FOLDER_PROVIDERS.has(account.provider)) {
    return effectiveIds.length > 0 ? [unsupportedEntry(account)] : [];
  }
  const retainedIds = new Set(
    skillIds(resolveEffectiveItems({ items: library.items, projectDisabled: [], accountDisabled })),
  );
  const planned: SkillPlanEntry[] = [];
  for (const skillId of effectiveIds) {
    planned.push(await planSkill({ root, account, skillId, hashes }));
  }
  return [...planned, ...(await planRemovals({ account, retainedIds }))];
}

export async function planSkillTargets(input: {
  root: string;
  accounts: readonly ProfileSyncAccountInput[];
  library: ProfileSyncLibraryInput;
}): Promise<SkillPlanEntry[]> {
  const hashes = new Map<string, LibraryHash>();
  const entries: SkillPlanEntry[] = [];
  for (const account of input.accounts) {
    entries.push(...(await planAccountSkills({ ...input, account, hashes })));
  }
  return entries;
}

function stateMatchesPlan(input: { status: ProfileSyncStatus; state: TargetState }): boolean {
  const { status, state } = input;
  if (status === 'create') return state.kind === 'missing';
  if (status === 'conflict') return state.kind === 'foreign';
  return state.kind === 'managed';
}

async function installProjection(input: {
  root: string;
  entry: SkillPlanEntry;
  backupTo?: string;
}): Promise<void> {
  const { root, entry, backupTo } = input;
  const staged = join(entry.skillsDir, temporaryEntryName(''));
  try {
    await mkdir(entry.skillsDir, { recursive: true, mode: 0o700 });
    await mkdir(staged, { mode: 0o700 });
    await copySkillDir({ source: skillDir(root, entry.skillId), dest: staged });
    if ((await hashSkillDir(staged)) !== entry.libraryHash) {
      throw new SkillValidationError('library skill changed while syncing');
    }
    const marker = { managedBy: MANAGED_BY, id: entry.skillId, hash: entry.libraryHash };
    await writeFile(join(staged, SKILL_MARKER_FILE), `${JSON.stringify(marker)}\n`, {
      mode: 0o600,
    });
    await replaceEntry({ staged, target: entry.targetDir, ...(backupTo ? { backupTo } : {}) });
  } catch (error: unknown) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}

async function executeEntry(input: {
  root: string;
  entry: SkillPlanEntry;
  backupDir: string;
}): Promise<SkillApplyOutcome> {
  const { root, entry, backupDir } = input;
  const state = await inspectTarget({ skillsDir: entry.skillsDir, skillId: entry.skillId });
  if (!stateMatchesPlan({ status: entry.item.status, state })) return 'skipped';
  const backupTo = join(backupDir, 'skills', entry.accountId, entry.skillId);
  if (entry.item.status === 'remove') {
    await backupEntry({ source: entry.targetDir, dest: backupTo });
    await removeEntry(entry.targetDir);
    return 'applied';
  }
  if (entry.libraryHash === null) return 'skipped';
  await installProjection({ root, entry, ...(state.kind === 'missing' ? {} : { backupTo }) });
  return 'applied';
}

export async function applySkillEntry(input: {
  root: string;
  entry: SkillPlanEntry;
  backupDir: string;
  approved: ReadonlySet<string>;
}): Promise<SkillApplyOutcome> {
  const { root, entry, backupDir, approved } = input;
  const { status, id } = entry.item;
  if (status === 'unchanged' || status === 'incompatible') return 'skipped';
  if (status !== 'create' && !approved.has(id)) return 'skipped';
  try {
    return await serialize(entry.targetDir, () => executeEntry({ root, entry, backupDir }));
  } catch {
    // NOTE: a failed skill keeps its previous folder; the sync reports it as skipped and goes on
    return 'skipped';
  }
}
