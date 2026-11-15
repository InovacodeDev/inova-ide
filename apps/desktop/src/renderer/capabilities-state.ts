import type { SupportedLocale } from '@inova/core/types';
import type {
  CapabilityApplyMode,
  CapabilityItem,
  CapabilityKind,
  CapabilityListing,
} from '../shared/api';
import { translate } from './i18n';

export const CAPABILITY_TABS: readonly { kind: CapabilityKind; label: string }[] = [
  { kind: 'skill', label: 'Skills' },
  { kind: 'mcp', label: 'MCP' },
  { kind: 'connector', label: 'Conectores' },
  { kind: 'plugin', label: 'Plugins' },
];

export function capabilityTabLabel(
  kind: CapabilityKind,
  locale: SupportedLocale = 'pt-BR',
): string {
  return translate(locale, `capabilities.tab.${kind}`);
}

const APPLY_MODE_KEY: Record<
  CapabilityApplyMode,
  | 'capabilities.apply.launch'
  | 'capabilities.apply.accountFile'
  | 'capabilities.apply.globalFile'
  | 'capabilities.apply.unsupported'
> = {
  launch: 'capabilities.apply.launch',
  'account-file': 'capabilities.apply.accountFile',
  'global-file': 'capabilities.apply.globalFile',
  unsupported: 'capabilities.apply.unsupported',
};

export function applyModeLabel(
  mode: CapabilityApplyMode,
  locale: SupportedLocale = 'pt-BR',
): string {
  return translate(locale, APPLY_MODE_KEY[mode]);
}

export function visibleTabs(listing: CapabilityListing): CapabilityKind[] {
  return CAPABILITY_TABS.filter(({ kind }) => {
    const category = listing.categories.find((entry) => entry.kind === kind);
    return category !== undefined && (category.items.length > 0 || category.error !== null);
  }).map(({ kind }) => kind);
}

export function sortItems(items: readonly CapabilityItem[]): CapabilityItem[] {
  return [...items].sort((a, b) => {
    if (a.tokens !== null && b.tokens !== null && a.tokens !== b.tokens) {
      return b.tokens - a.tokens;
    }
    if (a.tokens !== null && b.tokens === null) return -1;
    if (a.tokens === null && b.tokens !== null) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function filterItems(input: {
  items: readonly CapabilityItem[];
  query: string;
}): CapabilityItem[] {
  const query = input.query.trim().toLowerCase();
  if (query === '') return [...input.items];
  return input.items.filter(
    (item) =>
      item.name.toLowerCase().includes(query) ||
      (item.description ?? '').toLowerCase().includes(query),
  );
}

export function shouldApplyListing(input: {
  requestId: number;
  latestRequestId: number;
  mounted: boolean;
}): boolean {
  return input.mounted && input.requestId === input.latestRequestId;
}

export function displayEnabled(input: {
  item: CapabilityItem;
  plugins: readonly CapabilityItem[];
}): boolean {
  const { item, plugins } = input;
  const { group } = item;
  if (group === null || item.applyMode !== 'unsupported') return item.enabled;
  const plugin = plugins.find(
    (candidate) => candidate.name === group || candidate.id.split('@')[0] === group,
  );
  return plugin === undefined ? item.enabled : plugin.enabled;
}
