import type { ComposerFormat } from './composer-format';

export interface InlineAutoformat {
  format: ComposerFormat;
  start: number;
  openLength: number;
  closeLength: number;
  inner: string;
}

export interface BlockAutoformat {
  format: ComposerFormat;
  consume: number;
}

interface InlineMark {
  char: string;
  length: number;
  format: ComposerFormat;
}

const MARKS: readonly InlineMark[] = [
  { char: '*', length: 2, format: 'bold' },
  { char: '~', length: 2, format: 'strike' },
  { char: '`', length: 1, format: 'code' },
  { char: '*', length: 1, format: 'bold' },
  { char: '_', length: 1, format: 'italic' },
  { char: '~', length: 1, format: 'strike' },
];

const WORD_CHAR = /[\p{L}\p{N}_]/u;
// NOTE: U+200B is the caret anchor RichComposer leaves after a formatted span.
const OPENING_BOUNDARY = /[\s​([{"']/u;

function opensAt(input: { before: string; index: number; mark: InlineMark }): boolean {
  const { before, index, mark } = input;
  if (before.slice(index, index + mark.length) !== mark.char.repeat(mark.length)) return false;
  if (index === 0) return true;
  const previous = before.charAt(index - 1);
  return previous !== mark.char && OPENING_BOUNDARY.test(previous);
}

function validInner(inner: string, mark: InlineMark): boolean {
  return inner !== '' && inner === inner.trim() && !inner.includes(mark.char);
}

function matchMark(input: { before: string; mark: InlineMark }): InlineAutoformat | null {
  const { before, mark } = input;
  const closer = mark.char.repeat(mark.length);
  if (!before.endsWith(closer)) return null;
  const innerEnd = before.length - mark.length;
  if (mark.length === 1 && before.charAt(innerEnd - 1) === mark.char) return null;
  for (let index = innerEnd - 1; index >= 0; index -= 1) {
    if (!opensAt({ before, index, mark })) continue;
    const inner = before.slice(index + mark.length, innerEnd);
    if (!validInner(inner, mark)) continue;
    return {
      format: mark.format,
      start: index,
      openLength: mark.length,
      closeLength: mark.length,
      inner,
    };
  }
  return null;
}

export function detectInlineAutoformat(input: {
  before: string;
  after: string;
}): InlineAutoformat | null {
  const { before, after } = input;
  const next = after.charAt(0);
  if (next !== '' && WORD_CHAR.test(next)) return null;
  for (const mark of MARKS) {
    const hit = matchMark({ before, mark });
    if (hit !== null) return hit;
  }
  return null;
}

export function detectBlockAutoformat(lineText: string): BlockAutoformat | null {
  if (lineText === '- ' || lineText === '* ') return { format: 'bullet', consume: 2 };
  if (lineText === '> ') return { format: 'quote', consume: 2 };
  if (lineText === '```') return { format: 'codeblock', consume: 3 };
  const ordered = /^\d{1,9}\. $/.exec(lineText);
  return ordered === null ? null : { format: 'ordered', consume: lineText.length };
}
