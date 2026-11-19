import { describe, expect, test } from 'vitest';
import {
  MENU_MARGIN,
  MENU_WIDTH,
  availableCloseScopes,
  clampMenuPosition,
  contextMenuAnchor,
  isKeyboardOrigin,
  isMiddleButton,
  menuHeight,
  nextMenuIndex,
  tabsToClose,
} from '../src/renderer/context-menu';

const ids = ['a', 'b', 'c', 'd'];
const viewport = { width: 1200, height: 800 };

describe('tabsToClose', () => {
  test('self targets only the clicked tab', () => {
    expect(tabsToClose({ ids, targetId: 'b', scope: 'self' })).toEqual(['b']);
  });

  test('others targets every tab except the clicked one', () => {
    expect(tabsToClose({ ids, targetId: 'b', scope: 'others' })).toEqual(['a', 'c', 'd']);
  });

  test('right targets only the tabs after the clicked one', () => {
    expect(tabsToClose({ ids, targetId: 'b', scope: 'right' })).toEqual(['c', 'd']);
  });

  test('all targets every tab', () => {
    expect(tabsToClose({ ids, targetId: 'b', scope: 'all' })).toEqual(ids);
  });
});

describe('availableCloseScopes', () => {
  test('lists every scope for a middle tab', () => {
    expect(availableCloseScopes({ ids, targetId: 'b', withRight: true })).toEqual([
      'self',
      'others',
      'right',
      'all',
    ]);
  });

  test('omits right when the viewer does not support it', () => {
    expect(availableCloseScopes({ ids, targetId: 'b', withRight: false })).toEqual([
      'self',
      'others',
      'all',
    ]);
  });
});

describe('middle button', () => {
  test('only button 1 counts as middle click', () => {
    expect(isMiddleButton(1)).toBe(true);
    expect(isMiddleButton(0)).toBe(false);
    expect(isMiddleButton(2)).toBe(false);
  });
});

describe('clampMenuPosition', () => {
  test('keeps the cursor position when the menu fits', () => {
    expect(clampMenuPosition({ point: { x: 100, y: 120 }, itemCount: 3, viewport })).toEqual({
      top: 120,
      left: 100,
    });
  });

  test('keeps the menu fully inside the viewport', () => {
    const position = clampMenuPosition({ point: { x: 1190, y: 790 }, itemCount: 4, viewport });
    expect(position.left + MENU_WIDTH).toBeLessThanOrEqual(viewport.width - MENU_MARGIN);
    expect(position.top + menuHeight(4)).toBeLessThanOrEqual(viewport.height - MENU_MARGIN);
  });
});

describe('menu geometry and keyboard', () => {
  test('height estimate is items * 32 + 12', () => {
    expect(menuHeight(5)).toBe(172);
  });

  test('keyboard origin anchors at the bottom-left of the element', () => {
    expect(isKeyboardOrigin({ clientX: 0, clientY: 0 })).toBe(true);
    expect(contextMenuAnchor({ clientX: 0, clientY: 0, rect: { left: 40, bottom: 90 } })).toEqual({
      x: 40,
      y: 90,
    });
  });

  test('mouse origin anchors at the cursor', () => {
    expect(
      contextMenuAnchor({ clientX: 300, clientY: 200, rect: { left: 40, bottom: 90 } }),
    ).toEqual({ x: 300, y: 200 });
  });

  test('arrow keys move through items and wrap', () => {
    expect(nextMenuIndex({ current: 0, count: 3, key: 'ArrowDown' })).toBe(1);
    expect(nextMenuIndex({ current: 2, count: 3, key: 'ArrowDown' })).toBe(0);
    expect(nextMenuIndex({ current: 0, count: 3, key: 'ArrowUp' })).toBe(2);
  });
});
