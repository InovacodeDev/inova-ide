import { describe, expect, test } from 'vitest';
import {
  SHORTCUTS,
  findShortcut,
  formatBinding,
  formatShortcut,
  groupShortcuts,
  isMacPlatform,
  matchShortcut,
  matchTabIndex,
  resolveShortcutCommand,
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

describe('resolveShortcutCommand', () => {
  const cmdN = press({ key: 'n', code: 'KeyN', metaKey: true });
  const cmdComma = press({ key: ',', code: 'Comma', metaKey: true });
  const cmdTwo = press({ key: '2', code: 'Digit2', metaKey: true });
  const base = { isMac: true, settingsOpen: false, otherModalOpen: false };

  test('maps global shortcuts and tab digits to commands', () => {
    expect(resolveShortcutCommand({ ...base, event: cmdN })).toEqual({
      id: 'new-session',
      tabIndex: null,
    });
    expect(resolveShortcutCommand({ ...base, event: cmdTwo })).toEqual({
      id: 'select-tab',
      tabIndex: 1,
    });
    expect(resolveShortcutCommand({ ...base, event: press({ key: 'x' }) })).toBeNull();
  });

  test('another modal blocks every shortcut, including open-settings', () => {
    const blocked = { ...base, otherModalOpen: true };
    expect(resolveShortcutCommand({ ...blocked, event: cmdN })).toBeNull();
    expect(resolveShortcutCommand({ ...blocked, event: cmdComma })).toBeNull();
    expect(resolveShortcutCommand({ ...blocked, event: cmdTwo })).toBeNull();
  });

  test('with settings open only open-settings runs', () => {
    const open = { ...base, settingsOpen: true };
    expect(resolveShortcutCommand({ ...open, event: cmdComma })?.id).toBe('open-settings');
    expect(resolveShortcutCommand({ ...open, event: cmdN })).toBeNull();
    expect(resolveShortcutCommand({ ...open, event: cmdTwo })).toBeNull();
  });
});

describe('formatShortcut', () => {
  test('formats the catalog binding of a shortcut id for the platform', () => {
    expect(formatShortcut({ id: 'open-settings', isMac: true })).toBe('⌘,');
    expect(formatShortcut({ id: 'open-settings', isMac: false })).toBe('Ctrl+,');
  });
});

describe('isMacPlatform', () => {
  test('detects macOS platform strings only', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('MacARM')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
    expect(isMacPlatform('Linux x86_64')).toBe(false);
    expect(isMacPlatform('')).toBe(false);
  });
});

describe('groupShortcuts', () => {
  test('keeps every shortcut once and groups by first appearance', () => {
    const groups = groupShortcuts(SHORTCUTS);
    expect(groups.map((entry) => entry.group)).toEqual(['Geral', 'Sessões', 'Abas', 'Composer']);
    expect(groups.flatMap((entry) => entry.items)).toHaveLength(SHORTCUTS.length);
    expect(groups[0]?.items.every((item) => item.group === 'Geral')).toBe(true);
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
