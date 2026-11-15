import type { KeyboardEvent } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { handleHorizontalTabListKeyDown, moveTabIndex } from '../src/renderer/tablist-nav';

describe('moveTabIndex', () => {
  test('returns null when tablist is empty or key is unsupported', () => {
    expect(moveTabIndex({ currentIndex: 0, total: 0, key: 'ArrowRight' })).toBeNull();
    expect(moveTabIndex({ currentIndex: 0, total: 3, key: 'Enter' })).toBeNull();
    expect(moveTabIndex({ currentIndex: 1, total: 3, key: 'ArrowDown' })).toBeNull();
  });

  test('moves right and wraps at the end', () => {
    expect(moveTabIndex({ currentIndex: 0, total: 3, key: 'ArrowRight' })).toBe(1);
    expect(moveTabIndex({ currentIndex: 2, total: 3, key: 'ArrowRight' })).toBe(0);
  });

  test('moves left and wraps at the beginning', () => {
    expect(moveTabIndex({ currentIndex: 2, total: 3, key: 'ArrowLeft' })).toBe(1);
    expect(moveTabIndex({ currentIndex: 0, total: 3, key: 'ArrowLeft' })).toBe(2);
  });

  test('jumps to first or last tab on Home and End', () => {
    expect(moveTabIndex({ currentIndex: 2, total: 4, key: 'Home' })).toBe(0);
    expect(moveTabIndex({ currentIndex: 0, total: 4, key: 'End' })).toBe(3);
  });
});

describe('handleHorizontalTabListKeyDown', () => {
  test('selects target tab and moves focus on ArrowRight', () => {
    const focusFirst = vi.fn();
    const focusSecond = vi.fn();
    const preventDefault = vi.fn();
    const onSelect = vi.fn();

    const currentTarget = {
      querySelectorAll: () => [{ focus: focusFirst }, { focus: focusSecond }],
    };
    const event = {
      key: 'ArrowRight',
      preventDefault,
      currentTarget,
    } as unknown as KeyboardEvent<HTMLElement>;

    handleHorizontalTabListKeyDown({
      event,
      ids: ['first', 'second'] as const,
      activeId: 'first',
      onSelect,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('second');
    expect(focusSecond).toHaveBeenCalledTimes(1);
    expect(focusFirst).not.toHaveBeenCalled();
  });

  test('ignores unrelated keys without preventing default', () => {
    const preventDefault = vi.fn();
    const onSelect = vi.fn();

    const event = {
      key: 'Tab',
      preventDefault,
      currentTarget: { querySelectorAll: () => [] },
    } as unknown as KeyboardEvent<HTMLElement>;

    handleHorizontalTabListKeyDown({
      event,
      ids: ['first', 'second'] as const,
      activeId: 'first',
      onSelect,
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
