import type {
  CapabilityApplyMode,
  CapabilityItem,
  CapabilityKind,
  CapabilityListing,
} from '../shared/api';

export const CAPABILITY_TABS: readonly { kind: CapabilityKind; label: string }[] = [
  { kind: 'skill', label: 'Skills' },
  { kind: 'mcp', label: 'MCP' },
  { kind: 'connector', label: 'Conectores' },
  { kind: 'plugin', label: 'Plugins' },
];

const APPLY_MODE_LABEL: Record<CapabilityApplyMode, string> = {
  launch: 'Só no Inova',
  'account-file': 'Na conta',
  'global-file': 'Global',
  unsupported: 'Não configurável',
};

export function applyModeLabel(mode: CapabilityApplyMode): string {
  return APPLY_MODE_LABEL[mode];
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
