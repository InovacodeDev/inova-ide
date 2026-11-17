import type { CapabilityRef } from '../capabilities/types.js';
import type { LibraryItem } from './types.js';

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
      !accountDisabled.some((ref) => ref.kind === item.kind && ref.id === item.id),
  );
}
