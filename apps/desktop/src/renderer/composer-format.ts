import { matchShortcut, SHORTCUTS, type ShortcutEvent, type ShortcutId } from './shortcuts';

export type ComposerFormat =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'link'
  | 'bullet'
  | 'ordered'
  | 'quote'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'paragraph'
  | 'codeblock'
  | 'divider';

export type LineBreakCommand = 'insertParagraph' | 'insertLineBreak';

const FORMAT_BY_SHORTCUT: Readonly<Partial<Record<ShortcutId, ComposerFormat>>> = {
  'format-bold': 'bold',
  'format-italic': 'italic',
  'format-underline': 'underline',
  'format-strike': 'strike',
  'format-code': 'code',
  'format-link': 'link',
};

const FORMAT_BY_TAG: Readonly<Record<string, ComposerFormat>> = {
  b: 'bold',
  strong: 'bold',
  i: 'italic',
  em: 'italic',
  u: 'underline',
  s: 'strike',
  strike: 'strike',
  del: 'strike',
  code: 'code',
  a: 'link',
  blockquote: 'quote',
  h1: 'heading1',
  h2: 'heading2',
  h3: 'heading3',
  pre: 'codeblock',
};

const PARAGRAPH_BREAK_TAGS: ReadonlySet<string> = new Set(['li', 'h1', 'h2', 'h3']);

export function formatForShortcut(input: {
  event: ShortcutEvent;
  isMac: boolean;
}): ComposerFormat | null {
  const hit = SHORTCUTS.find(
    (item) =>
      FORMAT_BY_SHORTCUT[item.id] !== undefined &&
      matchShortcut(input.event, item.binding, input.isMac),
  );
  return hit === undefined ? null : (FORMAT_BY_SHORTCUT[hit.id] ?? null);
}

export function formatsForAncestors(tagNames: readonly string[]): Set<ComposerFormat> {
  const names = tagNames.map((name) => name.toLowerCase());
  const formats = new Set<ComposerFormat>();
  for (const name of names) {
    const format = FORMAT_BY_TAG[name];
    if (format !== undefined) formats.add(format);
  }
  const list = names.find((name) => name === 'ul' || name === 'ol');
  if (list === 'ul') formats.add('bullet');
  if (list === 'ol') formats.add('ordered');
  return formats;
}

export function lineBreakCommand(tagNames: readonly string[]): LineBreakCommand {
  const insideBlock = tagNames.some((name) => PARAGRAPH_BREAK_TAGS.has(name.toLowerCase()));
  return insideBlock ? 'insertParagraph' : 'insertLineBreak';
}
