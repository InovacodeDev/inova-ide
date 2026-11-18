import type { CapabilityRef } from '../capabilities/types.js';
import type { LibraryItem } from './types.js';

function isDisabledOnAccount(item: LibraryItem, refs: readonly CapabilityRef[]): boolean {
  return refs.some(
    (ref) =>
      ref.id === item.id &&
      (ref.kind === item.kind || (item.kind === 'connector' && ref.kind === 'mcp')),
  );
}

export function resolveEffectiveItems(input: {
  items: readonly LibraryItem[];
  projectDisabled: readonly string[];
  accountDisabled: readonly CapabilityRef[];
}): LibraryItem[] {
  const { items, projectDisabled, accountDisabled } = input;
  return items.filter(
    (item) =>
      item.enabled &&
      !projectDisabled.includes(item.id) &&
      !isDisabledOnAccount(item, accountDisabled),
  );
}
