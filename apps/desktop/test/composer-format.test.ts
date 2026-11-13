import { describe, expect, test } from 'vitest';
import {
  formatForShortcut,
  formatsForAncestors,
  lineBreakCommand,
} from '../src/renderer/composer-format';
import type { ShortcutEvent } from '../src/renderer/shortcuts';

describe('formatForShortcut', () => {
  const press = (key: string, extra: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
    key,
    code: '',
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  });

  test('maps mod shortcuts to formats on macOS', () => {
    expect(formatForShortcut({ event: press('b'), isMac: true })).toBe('bold');
    expect(formatForShortcut({ event: press('k'), isMac: true })).toBe('link');
    expect(formatForShortcut({ event: press('X', { shiftKey: true }), isMac: true })).toBe(
      'strike',
    );
  });

  test('ignores other keys and the wrong modifier', () => {
    expect(formatForShortcut({ event: press('l'), isMac: true })).toBeNull();
    expect(formatForShortcut({ event: press('b'), isMac: false })).toBeNull();
  });
});

describe('formatsForAncestors', () => {
  test('maps inline and block ancestors to formats', () => {
    const formats = formatsForAncestors(['I', 'B', 'H2', 'BLOCKQUOTE']);
    expect([...formats].sort()).toEqual(['bold', 'heading2', 'italic', 'quote']);
  });

  test('uses the nearest list to tell bullet from ordered', () => {
    expect([...formatsForAncestors(['li', 'ol', 'li', 'ul'])]).toEqual(['ordered']);
    expect([...formatsForAncestors(['li', 'ul'])]).toEqual(['bullet']);
  });

  test('returns nothing for plain ancestors', () => {
    expect(formatsForAncestors(['div']).size).toBe(0);
  });
});

describe('lineBreakCommand', () => {
  test('starts a new block inside lists and headings', () => {
    expect(lineBreakCommand(['li', 'ul'])).toBe('insertParagraph');
    expect(lineBreakCommand(['h1'])).toBe('insertParagraph');
  });

  test('inserts a line break elsewhere', () => {
    expect(lineBreakCommand(['div'])).toBe('insertLineBreak');
    expect(lineBreakCommand(['pre'])).toBe('insertLineBreak');
    expect(lineBreakCommand(['blockquote'])).toBe('insertLineBreak');
    expect(lineBreakCommand([])).toBe('insertLineBreak');
  });
});
