import { describe, expect, test } from 'vitest';
import {
  MENU_MARGIN,
  MENU_WIDTH,
  availableCloseScopes,
  clampMenuPosition,
  contextMenuAnchor,
  isKeyboardOrigin,
  isMiddleButton,
  nextMenuIndex,
  tabsToClose,
} from '../src/renderer/context-menu';

describe('tabsToClose edge cases', () => {
  test('returns nothing for an unknown target id', () => {
    for (const scope of ['self', 'others', 'right', 'all'] as const) {
      expect(tabsToClose({ ids: ['a', 'b'], targetId: 'x', scope })).toEqual([]);
    }
  });

  test('single tab has no other tabs and nothing to the right', () => {
    expect(tabsToClose({ ids: ['a'], targetId: 'a', scope: 'others' })).toEqual([]);
    expect(tabsToClose({ ids: ['a'], targetId: 'a', scope: 'right' })).toEqual([]);
    expect(tabsToClose({ ids: ['a'], targetId: 'a', scope: 'self' })).toEqual(['a']);
  });

  test('last tab has nothing to the right', () => {
    expect(tabsToClose({ ids: ['a', 'b', 'c'], targetId: 'c', scope: 'right' })).toEqual([]);
  });

  test('all does not share the input array', () => {
    const ids = ['a', 'b'];
    const result = tabsToClose({ ids, targetId: 'a', scope: 'all' });
    result.push('z');
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('availableCloseScopes edge cases', () => {
  test('single tab only offers close', () => {
    expect(availableCloseScopes({ ids: ['a'], targetId: 'a', withRight: true })).toEqual(['self']);
  });

  test('last tab hides close to the right', () => {
    expect(availableCloseScopes({ ids: ['a', 'b'], targetId: 'b', withRight: true })).toEqual([
      'self',
      'others',
      'all',
    ]);
  });

  test('unknown target offers nothing', () => {
    expect(availableCloseScopes({ ids: ['a', 'b'], targetId: 'x', withRight: true })).toEqual([]);
  });
});

describe('clampMenuPosition edge cases', () => {
  test('tiny viewport falls back to the margin', () => {
    expect(
      clampMenuPosition({
        point: { x: 500, y: 500 },
        itemCount: 5,
        viewport: { width: 100, height: 100 },
      }),
    ).toEqual({ top: MENU_MARGIN, left: MENU_MARGIN });
  });

  test('negative cursor coordinates clamp to the margin', () => {
    expect(
      clampMenuPosition({
        point: { x: -50, y: -10 },
        itemCount: 2,
        viewport: { width: 1000, height: 700 },
      }),
    ).toEqual({ top: MENU_MARGIN, left: MENU_MARGIN });
  });

  test('right edge pushes the menu left', () => {
    const position = clampMenuPosition({
      point: { x: 995, y: 100 },
      itemCount: 2,
      viewport: { width: 1000, height: 700 },
    });
    expect(position.left).toBe(1000 - MENU_WIDTH - MENU_MARGIN);
    expect(position.top).toBe(100);
  });

  test('bottom edge pushes the menu up', () => {
    const position = clampMenuPosition({
      point: { x: 100, y: 695 },
      itemCount: 3,
      viewport: { width: 1000, height: 700 },
    });
    expect(position.top).toBe(700 - (3 * 32 + 12) - MENU_MARGIN);
    expect(position.left).toBe(100);
  });
});

describe('input origin edge cases', () => {
  test('keyboard-origin event at (0,0) uses the element rect', () => {
    expect(isKeyboardOrigin({ clientX: 0, clientY: 0 })).toBe(true);
    expect(contextMenuAnchor({ clientX: 0, clientY: 0, rect: { left: 12, bottom: 34 } })).toEqual({
      x: 12,
      y: 34,
    });
  });

  test('a mouse event on one zero axis is not keyboard origin', () => {
    expect(isKeyboardOrigin({ clientX: 0, clientY: 5 })).toBe(false);
    expect(isKeyboardOrigin({ clientX: 5, clientY: 0 })).toBe(false);
  });

  test('buttons other than 1 are not middle click', () => {
    expect(isMiddleButton(3)).toBe(false);
    expect(isMiddleButton(-1)).toBe(false);
  });

  test('menu navigation handles empty menus, unknown keys and no focus', () => {
    expect(nextMenuIndex({ current: -1, count: 0, key: 'ArrowDown' })).toBeNull();
    expect(nextMenuIndex({ current: 0, count: 3, key: 'Enter' })).toBeNull();
    expect(nextMenuIndex({ current: -1, count: 3, key: 'ArrowDown' })).toBe(0);
    expect(nextMenuIndex({ current: -1, count: 3, key: 'ArrowUp' })).toBe(2);
    expect(nextMenuIndex({ current: 0, count: 1, key: 'ArrowDown' })).toBe(0);
  });
});
