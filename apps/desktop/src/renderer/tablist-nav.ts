import type { KeyboardEvent } from 'react';

export function moveTabIndex(input: {
  currentIndex: number;
  total: number;
  key: string;
}): number | null {
  const { currentIndex, total, key } = input;
  if (total <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return total - 1;
  if (key === 'ArrowRight') return (currentIndex + 1 + total) % total;
  if (key === 'ArrowLeft') return (currentIndex - 1 + total) % total;
  return null;
}

export function handleHorizontalTabListKeyDown<T extends string>(input: {
  event: KeyboardEvent<HTMLElement>;
  ids: readonly T[];
  activeId: T | null;
  onSelect: (id: T) => void;
}): void {
  const { event, ids, activeId, onSelect } = input;
  const currentIndex = activeId === null ? 0 : Math.max(0, ids.indexOf(activeId));
  const nextIndex = moveTabIndex({ currentIndex, total: ids.length, key: event.key });
  if (nextIndex === null) return;
  const nextId = ids[nextIndex];
  if (nextId === undefined) return;
  event.preventDefault();
  onSelect(nextId);
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  tabs[nextIndex]?.focus();
}
