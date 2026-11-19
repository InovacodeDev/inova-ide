export const MENU_WIDTH = 220;
export const MENU_ITEM_HEIGHT = 32;
export const MENU_PADDING = 12;
export const MENU_MARGIN = 8;

export type TabCloseScope = 'self' | 'others' | 'right' | 'all';

export interface Point {
  x: number;
  y: number;
}

export interface AnchorRect {
  left: number;
  bottom: number;
}

export interface MenuPosition {
  top: number;
  left: number;
}

export function isMiddleButton(button: number): boolean {
  return button === 1;
}

export function isKeyboardOrigin(input: { clientX: number; clientY: number }): boolean {
  return input.clientX === 0 && input.clientY === 0;
}

export function menuHeight(itemCount: number): number {
  return itemCount * MENU_ITEM_HEIGHT + MENU_PADDING;
}

function clampAxis(input: { value: number; size: number; viewport: number }): number {
  const max = input.viewport - input.size - MENU_MARGIN;
  return Math.max(MENU_MARGIN, Math.min(input.value, max));
}

export function clampMenuPosition(input: {
  point: Point;
  itemCount: number;
  viewport: { width: number; height: number };
}): MenuPosition {
  const { point, itemCount, viewport } = input;
  return {
    top: clampAxis({ value: point.y, size: menuHeight(itemCount), viewport: viewport.height }),
    left: clampAxis({ value: point.x, size: MENU_WIDTH, viewport: viewport.width }),
  };
}

export function contextMenuAnchor(input: {
  clientX: number;
  clientY: number;
  rect: AnchorRect;
}): Point {
  if (isKeyboardOrigin(input)) return { x: input.rect.left, y: input.rect.bottom };
  return { x: input.clientX, y: input.clientY };
}

export function nextMenuIndex(input: {
  current: number;
  count: number;
  key: string;
}): number | null {
  const { current, count, key } = input;
  if (count === 0 || (key !== 'ArrowDown' && key !== 'ArrowUp')) return null;
  if (current === -1) return key === 'ArrowDown' ? 0 : count - 1;
  const delta = key === 'ArrowDown' ? 1 : -1;
  return (current + delta + count) % count;
}

export const TAB_SCOPE_LABEL_KEYS = {
  self: 'tabMenu.close',
  others: 'tabMenu.closeOthers',
  right: 'tabMenu.closeRight',
  all: 'tabMenu.closeAll',
} as const;

export function availableCloseScopes(input: {
  ids: readonly string[];
  targetId: string;
  withRight: boolean;
}): TabCloseScope[] {
  const { ids, targetId, withRight } = input;
  const scopes: TabCloseScope[] = ['self', 'others', 'right', 'all'];
  return scopes.filter((scope) => {
    if (scope === 'right' && !withRight) return false;
    if (scope === 'self') return ids.includes(targetId);
    const targets = tabsToClose({ ids, targetId, scope });
    return scope === 'all' ? targets.length > 1 : targets.length > 0;
  });
}

export function tabsToClose(input: {
  ids: readonly string[];
  targetId: string;
  scope: TabCloseScope;
}): string[] {
  const { ids, targetId, scope } = input;
  const index = ids.indexOf(targetId);
  if (index === -1) return [];
  switch (scope) {
    case 'self':
      return [targetId];
    case 'others':
      return ids.filter((id) => id !== targetId);
    case 'right':
      return ids.slice(index + 1);
    case 'all':
      return [...ids];
  }
}
