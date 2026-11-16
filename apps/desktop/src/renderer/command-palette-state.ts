import type { ExecutionMode, SupportedLocale } from '@inova/core/types';
import { translate } from './i18n';
import type { ShortcutId } from './shortcuts';

export type CommandPaletteCategory = 'Ações' | 'Sessões' | 'Projetos' | 'Modelos' | 'Modos';

export interface CommandPaletteItem {
  readonly id: string;
  readonly category: CommandPaletteCategory;
  readonly title: string;
  readonly subtitle?: string;
  readonly badge?: string;
  readonly shortcutId?: ShortcutId;
  readonly active?: boolean;
  readonly keywords?: readonly string[];
}

export interface CommandPaletteGroup {
  readonly category: CommandPaletteCategory;
  readonly items: readonly CommandPaletteItem[];
}

export interface BuildCommandPaletteInput {
  readonly sessions: readonly {
    id: string;
    title: string;
    projectName: string;
    providerLabel: string;
    branch: string | null;
    active: boolean;
    archived: boolean;
  }[];
  readonly projects: readonly {
    id: string;
    name: string;
    path: string;
    accountLabel: string;
  }[];
  readonly models: readonly {
    id: string;
    label: string;
    active: boolean;
  }[];
  readonly modes: readonly {
    id: ExecutionMode;
    label: string;
    active: boolean;
  }[];
  readonly actions: readonly {
    id: string;
    title: string;
    subtitle?: string;
    badge?: string;
    shortcutId?: ShortcutId;
    keywords?: readonly string[];
  }[];
  readonly fileViewer?: {
    open: boolean;
  };
  readonly locale?: SupportedLocale;
}

export interface ViewerPaletteActionInput {
  open: boolean;
  locale?: SupportedLocale;
}

export function buildViewerPaletteActions(input: ViewerPaletteActionInput): readonly {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: readonly string[];
}[] {
  const locale = input.locale ?? 'pt-BR';
  return [
    {
      id: 'action:toggle-file-viewer',
      title: input.open
        ? translate(locale, 'app.palette.toggleFileViewerClose')
        : translate(locale, 'app.palette.toggleFileViewerOpen'),
      keywords: ['viewer', 'arquivo', 'leitor', 'preview', 'file'],
    },
    {
      id: 'action:open-file-viewer',
      title: translate(locale, 'app.palette.openFileViewer'),
      subtitle: translate(locale, 'app.palette.openFileViewerSub'),
      keywords: ['abrir', 'arquivo', 'file', 'picker', 'selecionar'],
    },
  ];
}

export function paletteCategoryLabel(
  category: CommandPaletteCategory,
  locale: SupportedLocale = 'pt-BR',
): string {
  return translate(locale, `palette.cat.${category}`);
}

const CATEGORY_ORDER: readonly CommandPaletteCategory[] = [
  'Ações',
  'Sessões',
  'Projetos',
  'Modelos',
  'Modos',
];

function sessionRank(session: BuildCommandPaletteInput['sessions'][number]): number {
  if (session.active) return 0;
  if (!session.archived) return 1;
  return 2;
}

export function buildCommandPaletteItems(input: BuildCommandPaletteInput): CommandPaletteItem[] {
  const locale = input.locale ?? 'pt-BR';
  const activeBadge = translate(locale, 'palette.activeBadge');
  const archivedBadge = translate(locale, 'palette.archivedBadge');
  const newSessionBadge = translate(locale, 'palette.newSessionItem');
  const currentBadge = translate(locale, 'palette.currentBadge');

  const actionItems: CommandPaletteItem[] = input.actions.map((action) => ({
    id: action.id,
    category: 'Ações',
    title: action.title,
    ...(action.subtitle !== undefined ? { subtitle: action.subtitle } : {}),
    ...(action.badge !== undefined ? { badge: action.badge } : {}),
    ...(action.shortcutId !== undefined ? { shortcutId: action.shortcutId } : {}),
    ...(action.keywords !== undefined ? { keywords: action.keywords } : {}),
  }));

  const viewerItems: CommandPaletteItem[] = input.fileViewer
    ? buildViewerPaletteActions({ open: input.fileViewer.open, locale }).map((action) => ({
        id: action.id,
        category: 'Ações',
        title: action.title,
        ...(action.subtitle !== undefined ? { subtitle: action.subtitle } : {}),
        keywords: action.keywords,
      }))
    : [];

  const sortedSessions = [...input.sessions].sort((a, b) => sessionRank(a) - sessionRank(b));
  const sessionItems: CommandPaletteItem[] = sortedSessions.map((session) => ({
    id: `session:${session.id}`,
    category: 'Sessões',
    title: session.title,
    subtitle: `${session.projectName} · ${session.providerLabel}${
      session.branch ? ` · ${session.branch}` : ''
    }`,
    ...(session.active ? { badge: activeBadge } : session.archived ? { badge: archivedBadge } : {}),
    active: session.active,
    keywords: [
      session.projectName,
      session.providerLabel,
      ...(session.branch ? [session.branch] : []),
      ...(session.archived ? ['arquivada', 'archived'] : []),
    ],
  }));

  const projectItems: CommandPaletteItem[] = input.projects.map((project) => ({
    id: `project:${project.id}`,
    category: 'Projetos',
    title: project.name,
    subtitle: `${project.accountLabel} · ${project.path}`,
    badge: newSessionBadge,
    keywords: [
      project.path,
      project.accountLabel,
      'projeto',
      'project',
      'nova sessão',
      'new session',
    ],
  }));

  const modelItems: CommandPaletteItem[] = input.models.map((model) => ({
    id: `model:${model.id}`,
    category: 'Modelos',
    title: model.label,
    subtitle: model.id,
    ...(model.active ? { badge: currentBadge } : {}),
    active: model.active,
    keywords: [model.id, 'modelo', 'model'],
  }));

  const modeItems: CommandPaletteItem[] = input.modes.map((mode) => ({
    id: `mode:${mode.id}`,
    category: 'Modos',
    title: mode.label,
    subtitle: mode.id,
    ...(mode.active ? { badge: currentBadge } : {}),
    active: mode.active,
    keywords: [mode.id, 'modo', 'mode'],
  }));

  return [
    ...actionItems,
    ...viewerItems,
    ...sessionItems,
    ...projectItems,
    ...modelItems,
    ...modeItems,
  ];
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length === 0) return true;
  let needleIndex = 0;
  for (let i = 0; i < haystack.length && needleIndex < needle.length; i += 1) {
    if (haystack[i] === needle[needleIndex]) needleIndex += 1;
  }
  return needleIndex === needle.length;
}

function scoreToken(item: CommandPaletteItem, token: string): number {
  const title = item.title.toLowerCase();
  if (title === token) return 120;
  if (title.startsWith(token)) return 90;
  if (title.includes(token)) return 60;

  const subtitle = (item.subtitle ?? '').toLowerCase();
  if (subtitle.includes(token)) return 40;

  const category = item.category.toLowerCase();
  const badge = (item.badge ?? '').toLowerCase();
  const keywords = (item.keywords ?? []).join(' ').toLowerCase();
  if (category.includes(token) || badge.includes(token) || keywords.includes(token)) return 30;

  if (isSubsequence(token, title)) return 15;
  return 0;
}

export function filterCommandPaletteItems(
  items: readonly CommandPaletteItem[],
  query: string,
): CommandPaletteItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...items];

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const scored: { item: CommandPaletteItem; score: number; index: number }[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    let total = 0;
    let matchedAll = true;
    for (const token of tokens) {
      const score = scoreToken(item, token);
      if (score === 0) {
        matchedAll = false;
        break;
      }
      total += score;
    }
    if (matchedAll) {
      scored.push({
        item,
        score: total + (item.active ? 5 : 0),
        index,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.item);
}

export function groupCommandPaletteItems(
  items: readonly CommandPaletteItem[],
): CommandPaletteGroup[] {
  const buckets = new Map<CommandPaletteCategory, CommandPaletteItem[]>();
  for (const category of CATEGORY_ORDER) {
    buckets.set(category, []);
  }
  for (const item of items) {
    buckets.get(item.category)?.push(item);
  }
  const groups: CommandPaletteGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const entries = buckets.get(category);
    if (entries && entries.length > 0) {
      groups.push({ category, items: entries });
    }
  }
  return groups;
}

export function moveCommandPaletteIndex(input: {
  current: number;
  total: number;
  delta: 1 | -1;
}): number {
  if (input.total <= 0) return 0;
  return (((input.current + input.delta) % input.total) + input.total) % input.total;
}
