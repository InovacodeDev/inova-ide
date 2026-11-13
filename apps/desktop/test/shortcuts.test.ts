import { describe, expect, test } from 'vitest';
import {
  SHORTCUTS,
  findShortcut,
  formatBinding,
  matchShortcut,
  matchTabIndex,
  type ShortcutEvent,
} from '../src/renderer/shortcuts';

const press = (input: Partial<ShortcutEvent>): ShortcutEvent => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...input,
});

describe('matchShortcut', () => {
  test('mod is Cmd on macOS and Ctrl elsewhere', () => {
    const cmdComma = press({ key: ',', code: 'Comma', metaKey: true });
    const ctrlComma = press({ key: ',', code: 'Comma', ctrlKey: true });
    expect(matchShortcut(cmdComma, 'mod+,', true)).toBe(true);
    expect(matchShortcut(cmdComma, 'mod+,', false)).toBe(false);
    expect(matchShortcut(ctrlComma, 'mod+,', false)).toBe(true);
    expect(matchShortcut(ctrlComma, 'mod+,', true)).toBe(false);
  });

  test('extra modifiers do not match', () => {
    expect(matchShortcut(press({ key: 'n', metaKey: true, shiftKey: true }), 'mod+n', true)).toBe(
      false,
    );
    expect(matchShortcut(press({ key: 'n', metaKey: true, altKey: true }), 'mod+n', true)).toBe(
      false,
    );
    expect(matchShortcut(press({ key: 'n' }), 'mod+n', true)).toBe(false);
  });

  test('letters match by key regardless of case, brackets match by code', () => {
    expect(
      matchShortcut(press({ key: 'A', metaKey: true, shiftKey: true }), 'mod+shift+a', true),
    ).toBe(true);
    const shiftBracket = press({ key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true });
    expect(matchShortcut(shiftBracket, 'mod+shift+[', false)).toBe(true);
    expect(matchShortcut(shiftBracket, 'mod+shift+]', false)).toBe(false);
  });
});

describe('matchTabIndex', () => {
  test('returns the zero-based tab index for mod+1..9 only', () => {
    expect(matchTabIndex(press({ key: '1', code: 'Digit1', metaKey: true }), true)).toBe(0);
    expect(matchTabIndex(press({ key: '9', code: 'Digit9', ctrlKey: true }), false)).toBe(8);
    expect(matchTabIndex(press({ key: '0', code: 'Digit0', metaKey: true }), true)).toBeNull();
    expect(matchTabIndex(press({ key: '1', code: 'Digit1' }), true)).toBeNull();
    expect(
      matchTabIndex(press({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }), true),
    ).toBeNull();
  });
});

describe('findShortcut', () => {
  test('finds global shortcuts and ignores listed-only ones', () => {
    expect(findShortcut(press({ key: ',', code: 'Comma', metaKey: true }), true)).toBe(
      'open-settings',
    );
    expect(findShortcut(press({ key: 'Enter', code: 'Enter' }), true)).toBeNull();
    expect(findShortcut(press({ key: 'x', metaKey: true }), true)).toBeNull();
  });

  test('global bindings are unique', () => {
    const bindings = SHORTCUTS.filter((item) => item.global).map((item) => item.binding);
    expect(new Set(bindings).size).toBe(bindings.length);
  });
});

describe('formatBinding', () => {
  test('uses symbols on macOS and names elsewhere', () => {
    expect(formatBinding('mod+,', true)).toBe('⌘,');
    expect(formatBinding('mod+shift+a', true)).toBe('⌘⇧A');
    expect(formatBinding('mod+shift+a', false)).toBe('Ctrl+Shift+A');
    expect(formatBinding('mod+enter', false)).toBe('Ctrl+Enter');
    expect(formatBinding('esc', true)).toBe('Esc');
  });
});
