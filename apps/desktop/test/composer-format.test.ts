import { describe, expect, test } from 'vitest';
import {
  applyFormat,
  diffEdit,
  type ComposerFormat,
  type FormatResult,
} from '../src/renderer/composer-format';
import { formatForShortcut } from '../src/renderer/composer-textarea';
import type { ShortcutEvent } from '../src/renderer/shortcuts';

const run = (input: {
  value: string;
  start: number;
  end?: number;
  format: ComposerFormat;
}): FormatResult =>
  applyFormat({
    value: input.value,
    selectionStart: input.start,
    selectionEnd: input.end ?? input.start,
    format: input.format,
  });

const selected = (result: FormatResult): string =>
  result.value.slice(result.selectionStart, result.selectionEnd);

describe('inline formats', () => {
  test.each([
    ['bold', '**', '**'],
    ['italic', '_', '_'],
    ['strike', '~~', '~~'],
    ['code', '`', '`'],
    ['underline', '<u>', '</u>'],
  ] as const)('%s wraps the selection', (format, open, close) => {
    const result = run({ value: 'say hello now', start: 4, end: 9, format });
    expect(result.value).toBe(`say ${open}hello${close} now`);
    expect(selected(result)).toBe('hello');
  });

  test('empty selection inserts markers and puts the caret between', () => {
    const result = run({ value: 'ab', start: 1, format: 'bold' });
    expect(result.value).toBe('a****b');
    expect(result.selectionStart).toBe(3);
    expect(result.selectionEnd).toBe(3);
  });

  test('toggles off when markers surround the selection', () => {
    const result = run({ value: 'say **hello** now', start: 6, end: 11, format: 'bold' });
    expect(result.value).toBe('say hello now');
    expect(selected(result)).toBe('hello');
  });

  test('toggles off when the selection includes the markers', () => {
    const result = run({ value: 'say <u>hello</u> now', start: 4, end: 16, format: 'underline' });
    expect(result.value).toBe('say hello now');
    expect(selected(result)).toBe('hello');
  });

  test('toggles off an empty wrapped caret', () => {
    const result = run({ value: 'a****b', start: 3, format: 'bold' });
    expect(result.value).toBe('ab');
    expect(result.selectionStart).toBe(1);
  });
});

describe('link', () => {
  test('wraps the selection and selects the url placeholder', () => {
    const result = run({ value: 'see docs here', start: 4, end: 8, format: 'link' });
    expect(result.value).toBe('see [docs](url) here');
    expect(selected(result)).toBe('url');
  });

  test('empty selection inserts a placeholder label and selects it', () => {
    const result = run({ value: '', start: 0, format: 'link' });
    expect(result.value).toBe('[texto](url)');
    expect(selected(result)).toBe('texto');
  });

  test('a selected url becomes the target and the caret goes to the label', () => {
    const result = run({ value: 'https://a.dev', start: 0, end: 13, format: 'link' });
    expect(result.value).toBe('[](https://a.dev)');
    expect(result.selectionStart).toBe(1);
    expect(result.selectionEnd).toBe(1);
  });
});

describe('line formats', () => {
  test('bullet prefixes every selected line', () => {
    const result = run({ value: 'a\nb\nc', start: 0, end: 5, format: 'bullet' });
    expect(result.value).toBe('- a\n- b\n- c');
  });

  test('bullet toggles off when every line has it', () => {
    const result = run({ value: '- a\n- b', start: 0, end: 7, format: 'bullet' });
    expect(result.value).toBe('a\nb');
  });

  test('bullet adds to all lines when only some have it', () => {
    const result = run({ value: '- a\nb', start: 0, end: 5, format: 'bullet' });
    expect(result.value).toBe('- a\n- b');
  });

  test('ordered numbers lines sequentially', () => {
    const result = run({ value: 'a\nb\nc', start: 0, end: 5, format: 'ordered' });
    expect(result.value).toBe('1. a\n2. b\n3. c');
  });

  test('ordered toggles off', () => {
    const result = run({ value: '1. a\n2. b', start: 0, end: 9, format: 'ordered' });
    expect(result.value).toBe('a\nb');
  });

  test('ordered replaces a bullet prefix', () => {
    const result = run({ value: '- a\n- b', start: 0, end: 7, format: 'ordered' });
    expect(result.value).toBe('1. a\n2. b');
  });

  test('quote prefixes and toggles', () => {
    const on = run({ value: 'a\nb', start: 0, end: 3, format: 'quote' });
    expect(on.value).toBe('> a\n> b');
    const off = run({ value: on.value, start: 0, end: on.value.length, format: 'quote' });
    expect(off.value).toBe('a\nb');
  });

  test('only the touched lines change', () => {
    const result = run({ value: 'a\nb\nc', start: 2, end: 3, format: 'bullet' });
    expect(result.value).toBe('a\n- b\nc');
  });

  test('empty lines inside the selection are skipped', () => {
    const result = run({ value: 'a\n\nb', start: 0, end: 4, format: 'bullet' });
    expect(result.value).toBe('- a\n\n- b');
  });

  test('a caret on an empty document still gets the prefix', () => {
    const result = run({ value: '', start: 0, format: 'bullet' });
    expect(result.value).toBe('- ');
    expect(result.selectionStart).toBe(2);
  });

  test('the caret keeps its place in the text', () => {
    const result = run({ value: 'hello', start: 3, format: 'bullet' });
    expect(result.value).toBe('- hello');
    expect(result.selectionStart).toBe(5);
  });

  test('a trailing newline in the selection does not touch the next line', () => {
    const result = run({ value: 'a\nb', start: 0, end: 2, format: 'bullet' });
    expect(result.value).toBe('- a\nb');
  });
});

describe('headings', () => {
  test.each([
    ['heading1', '# a'],
    ['heading2', '## a'],
    ['heading3', '### a'],
  ] as const)('%s adds the prefix', (format, expected) => {
    expect(run({ value: 'a', start: 0, format }).value).toBe(expected);
  });

  test('a different level replaces the current one', () => {
    expect(run({ value: '# a', start: 0, format: 'heading2' }).value).toBe('## a');
  });

  test('the same level toggles off', () => {
    expect(run({ value: '## a', start: 0, format: 'heading2' }).value).toBe('a');
  });

  test('paragraph removes any heading prefix', () => {
    expect(run({ value: '### a', start: 0, format: 'paragraph' }).value).toBe('a');
    expect(run({ value: 'a', start: 0, format: 'paragraph' }).value).toBe('a');
  });
});

describe('blocks', () => {
  test('code block wraps the selection on its own lines', () => {
    const result = run({ value: 'x = 1', start: 0, end: 5, format: 'codeblock' });
    expect(result.value).toBe('```\nx = 1\n```');
    expect(selected(result)).toBe('x = 1');
  });

  test('code block splits from surrounding text', () => {
    const result = run({ value: 'a b c', start: 2, end: 3, format: 'codeblock' });
    expect(result.value).toBe('a \n```\nb\n```\n c');
  });

  test('code block with empty selection puts the caret inside', () => {
    const result = run({ value: '', start: 0, format: 'codeblock' });
    expect(result.value).toBe('```\n\n```');
    expect(result.selectionStart).toBe(4);
    expect(result.selectionEnd).toBe(4);
  });

  test('divider at the start of the document', () => {
    const result = run({ value: '', start: 0, format: 'divider' });
    expect(result.value).toBe('---\n');
    expect(result.selectionStart).toBe(4);
  });

  test('divider after text leaves a blank line so it is not a heading', () => {
    const result = run({ value: 'abc', start: 3, format: 'divider' });
    expect(result.value).toBe('abc\n\n---\n');
    expect(result.selectionStart).toBe(9);
  });

  test('divider after a newline adds only one blank line', () => {
    const result = run({ value: 'abc\n', start: 4, format: 'divider' });
    expect(result.value).toBe('abc\n\n---\n');
  });
});

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

describe('diffEdit', () => {
  test('returns the minimal replaced range', () => {
    expect(diffEdit({ before: 'ab', after: 'a**b' })).toEqual({ start: 1, end: 1, text: '**' });
  });

  test('describes a deletion', () => {
    expect(diffEdit({ before: 'a**b', after: 'ab' })).toEqual({ start: 1, end: 3, text: '' });
  });

  test('returns null for identical values', () => {
    expect(diffEdit({ before: 'same', after: 'same' })).toBeNull();
  });
});
