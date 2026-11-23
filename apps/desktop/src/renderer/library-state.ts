import type {
  LibraryItem,
  LibraryItemKind,
  PluginInstallRecipe,
  PluginLibraryItem,
  PluginPackageCommandMeta,
  PluginPackageDefinition,
  ProfileSyncApplyResult,
  ProjectLibraryBinding,
  SkillLibraryItem,
} from '../shared/api';
import type { TranslationKey } from './i18n';

export const LIBRARY_KINDS: readonly LibraryItemKind[] = ['skill', 'mcp', 'connector', 'plugin'];

export interface LibraryGroup {
  kind: LibraryItemKind;
  items: LibraryItem[];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareItems(a: LibraryItem, b: LibraryItem): number {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return byName !== 0 ? byName : compareText(a.id, b.id);
}

export function groupLibraryItems(items: readonly LibraryItem[]): LibraryGroup[] {
  return LIBRARY_KINDS.map((kind) => ({
    kind,
    items: items.filter((item) => item.kind === kind).sort(compareItems),
  })).filter((group) => group.items.length > 0);
}

export function libraryIdTaken(input: { items: readonly LibraryItem[]; id: string }): boolean {
  return input.items.some((item) => item.id === input.id);
}

export function itemDetail(item: LibraryItem): string {
  switch (item.kind) {
    case 'skill':
      return '';
    case 'mcp': {
      const { definition } = item;
      return 'url' in definition ? definition.url : definition.command;
    }
    case 'connector':
      return `${item.label} · ${item.definition.url}`;
    case 'plugin': {
      if ('format' in item.definition && item.definition.format === 'package') {
        const { manifestFormat, version, skills, commands } = item.definition;
        const parts = [`ZIP (${manifestFormat})`];
        if (version) parts.push(`v${version}`);
        if (skills.length > 0) parts.push(`${skills.length} skills`);
        if (commands.length > 0) parts.push(`${commands.length} comandos`);
        return parts.join(' · ');
      }
      const { provider, marketplace, name } = item.definition;
      return `${provider} · ${name}${marketplace === undefined ? '' : `@${marketplace}`}`;
    }
  }
}

export type ProjectItemStatus = 'effective' | 'project-off' | 'library-off';

export interface ProjectItemRow {
  item: LibraryItem;
  status: ProjectItemStatus;
  effective: boolean;
}

export function projectItemStatus(input: {
  enabled: boolean;
  id: string;
  projectDisabled?: readonly string[];
}): ProjectItemStatus {
  const { enabled, id, projectDisabled = [] } = input;
  if (!enabled) return 'library-off';
  return projectDisabled.includes(id) ? 'project-off' : 'effective';
}

export function projectItemRows(input: {
  items: readonly LibraryItem[];
  projectDisabled?: readonly string[];
}): ProjectItemRow[] {
  const { items, projectDisabled } = input;
  return groupLibraryItems(items)
    .flatMap((group) => group.items)
    .map((item) => {
      const status = projectItemStatus({
        enabled: item.enabled,
        id: item.id,
        ...(projectDisabled ? { projectDisabled } : {}),
      });
      return { item, status, effective: status === 'effective' };
    });
}

export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

export interface SyncItemLike {
  id: string;
  status: string;
  reason?: string;
}

const APPROVAL_STATUSES: ReadonlySet<string> = new Set(['update', 'conflict', 'remove']);
const AUTO_STATUSES: ReadonlySet<string> = new Set(['create']);

export function needsApproval(item: { status: string }): boolean {
  return APPROVAL_STATUSES.has(item.status);
}

export interface ApprovableItemLike extends SyncItemLike {
  approvalKey: string;
}

export function applyableIds(input: {
  items: readonly ApprovableItemLike[];
  approvedIds: readonly string[];
}): string[] {
  const approved = new Set(input.approvedIds);
  const keys = input.items
    .filter((item) => needsApproval(item) && approved.has(item.approvalKey))
    .map((item) => item.approvalKey);
  return [...new Set(keys)];
}

export interface SelectionSummary {
  autoCount: number;
  approvedCount: number;
  pendingCount: number;
  willApplyCount: number;
}

export function selectionSummary(input: {
  items: readonly ApprovableItemLike[];
  approvedIds: readonly string[];
}): SelectionSummary {
  const { items } = input;
  const autoCount = items.filter((item) => AUTO_STATUSES.has(item.status)).length;
  const approvedCount = applyableIds(input).length;
  const approvalIds = new Set(items.filter(needsApproval).map((item) => item.approvalKey));
  const pendingCount = approvalIds.size - approvedCount;
  return { autoCount, approvedCount, pendingCount, willApplyCount: autoCount + approvedCount };
}

export type StatusTone = 'ok' | 'accent' | 'muted' | 'warn' | 'error';
export type StatusIcon = 'plus' | 'refresh' | 'check' | 'alert' | 'shield' | 'trash';

export interface StatusPresentation {
  labelKey: TranslationKey;
  icon: StatusIcon;
  tone: StatusTone;
  known: boolean;
}

const STATUS_PRESENTATION: Readonly<Record<string, Omit<StatusPresentation, 'known'>>> = {
  create: { labelKey: 'profileSync.status.create', icon: 'plus', tone: 'ok' },
  update: { labelKey: 'profileSync.status.update', icon: 'refresh', tone: 'accent' },
  unchanged: { labelKey: 'profileSync.status.unchanged', icon: 'check', tone: 'muted' },
  conflict: { labelKey: 'profileSync.status.conflict', icon: 'alert', tone: 'warn' },
  incompatible: { labelKey: 'profileSync.status.incompatible', icon: 'shield', tone: 'error' },
  remove: { labelKey: 'profileSync.status.remove', icon: 'trash', tone: 'warn' },
};

const UNKNOWN_PRESENTATION: StatusPresentation = {
  labelKey: 'library.status.unknown',
  icon: 'alert',
  tone: 'muted',
  known: false,
};

export function statusPresentation(status: string): StatusPresentation {
  const found = Object.hasOwn(STATUS_PRESENTATION, status)
    ? STATUS_PRESENTATION[status]
    : undefined;
  return found ? { ...found, known: true } : UNKNOWN_PRESENTATION;
}

export function approvalWarningKey(status: string): TranslationKey | null {
  if (status === 'conflict') return 'library.sync.warnConflict';
  if (status === 'remove') return 'library.sync.warnRemove';
  return null;
}

export function reasonText(input: { item: SyncItemLike; fallback: string }): string | null {
  const { item, fallback } = input;
  const reason = item.reason?.trim() ?? '';
  if (reason !== '') return reason;
  return item.status === 'incompatible' ? fallback : null;
}

export interface ApplySummary {
  appliedIds: string[];
  skippedIds: string[];
  appliedCount: number;
  skippedCount: number;
  backupDir: string;
}

export function summarizeApply(result: ProfileSyncApplyResult): ApplySummary {
  const appliedIds = [...new Set(result.appliedIds)];
  const skippedIds = [...new Set(result.skippedIds)].filter((id) => !appliedIds.includes(id));
  return {
    appliedIds,
    skippedIds,
    appliedCount: appliedIds.length,
    skippedCount: skippedIds.length,
    backupDir: result.backupDir,
  };
}

export function accountsForProvider<T extends { provider: string }>(
  accounts: readonly T[],
  provider: string,
): T[] {
  return accounts.filter((account) => account.provider === provider);
}

export function recipeFor(
  recipes: Readonly<Record<string, PluginInstallRecipe>> | undefined,
  id: string,
): PluginInstallRecipe | undefined {
  return recipes !== undefined && Object.hasOwn(recipes, id) ? recipes[id] : undefined;
}

type ReadyRecipe = Extract<PluginInstallRecipe, { ok: true }>;

export type PluginInstallState =
  | ({ kind: 'ready' } & Pick<ReadyRecipe, 'commandId' | 'params'>)
  | { kind: 'unsupported'; reason: string | null }
  | { kind: 'no-account' };

export function pluginInstallState(input: {
  recipe: PluginInstallRecipe | undefined;
  accountCount: number;
}): PluginInstallState {
  const { recipe, accountCount } = input;
  if (recipe === undefined) return { kind: 'unsupported', reason: null };
  if (!recipe.ok) return { kind: 'unsupported', reason: recipe.reason };
  if (accountCount === 0) return { kind: 'no-account' };
  return { kind: 'ready', commandId: recipe.commandId, params: recipe.params };
}

export function syncAccountSelection(input: {
  allIds: readonly string[];
  excludedIds: readonly string[];
}): { ids: string[]; request: string[] | undefined } {
  const ids = input.allIds.filter((id) => !input.excludedIds.includes(id));
  return { ids, request: ids.length === input.allIds.length ? undefined : ids };
}

export function canPreviewSync(input: {
  projectId: string | null;
  accountCount: number;
  selectedCount: number;
}): boolean {
  const { projectId, accountCount, selectedCount } = input;
  return projectId !== null && (accountCount === 0 || selectedCount > 0);
}

export function isPluginPackageItem(
  item: LibraryItem,
): item is PluginLibraryItem & { definition: PluginPackageDefinition } {
  return (
    item.kind === 'plugin' && 'format' in item.definition && item.definition.format === 'package'
  );
}

export interface ProjectPluginSkillState {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
}

export interface ProjectSkillPluginRow {
  item: SkillLibraryItem | PluginLibraryItem;
  binding: ProjectLibraryBinding;
  status: ProjectItemStatus;
  effective: boolean;
  packageSkills: ProjectPluginSkillState[];
  packageCommands: readonly PluginPackageCommandMeta[];
}

export interface ProjectSkillPluginState {
  imported: ProjectSkillPluginRow[];
  available: (SkillLibraryItem | PluginLibraryItem)[];
}

export function projectSkillPluginState(input: {
  items: readonly LibraryItem[];
  bindings?: readonly ProjectLibraryBinding[];
}): ProjectSkillPluginState {
  const candidates = input.items
    .filter(
      (item): item is SkillLibraryItem | PluginLibraryItem =>
        item.kind === 'skill' || item.kind === 'plugin',
    )
    .sort(compareItems);
  const byId = new Map((input.bindings ?? []).map((binding) => [binding.itemId, binding]));
  const imported: ProjectSkillPluginRow[] = [];
  const available: (SkillLibraryItem | PluginLibraryItem)[] = [];

  for (const item of candidates) {
    const binding = byId.get(item.id);
    if (!binding) {
      available.push(item);
      continue;
    }
    const status: ProjectItemStatus = !item.enabled
      ? 'library-off'
      : binding.enabled
        ? 'effective'
        : 'project-off';
    const disabledSet = new Set(binding.disabledSkills ?? []);
    const isPkg = isPluginPackageItem(item);
    const packageSkills: ProjectPluginSkillState[] = isPkg
      ? item.definition.skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          enabled: !disabledSet.has(skill.id),
        }))
      : [];
    const packageCommands = isPkg ? item.definition.commands : [];
    imported.push({
      item,
      binding,
      status,
      effective: status === 'effective',
      packageSkills,
      packageCommands,
    });
  }

  return { imported, available };
}

export function projectMcpConnectorRows(input: {
  items: readonly LibraryItem[];
  projectDisabled?: readonly string[];
}): ProjectItemRow[] {
  return projectItemRows({
    items: input.items.filter((item) => item.kind === 'mcp' || item.kind === 'connector'),
    ...(input.projectDisabled ? { projectDisabled: input.projectDisabled } : {}),
  });
}
