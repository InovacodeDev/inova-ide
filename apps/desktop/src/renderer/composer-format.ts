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

export interface FormatInput {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  format: ComposerFormat;
}

export interface FormatResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

type InlineFormat = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

const INLINE_MARKERS: Readonly<Record<InlineFormat, { open: string; close: string }>> = {
  bold: { open: '**', close: '**' },
  italic: { open: '_', close: '_' },
  underline: { open: '<u>', close: '</u>' },
  strike: { open: '~~', close: '~~' },
  code: { open: '`', close: '`' },
};

const BULLET_PREFIX = /^- /;
const ORDERED_PREFIX = /^\d+\. /;
const QUOTE_PREFIX = /^> /;
const HEADING_PREFIX = /^#{1,6} /;
const URL_SELECTION = /^https?:\/\/\S+$/;
const LINK_LABEL_PLACEHOLDER = 'texto';
const LINK_URL_PLACEHOLDER = 'url';

function replaceRange(input: { value: string; start: number; end: number; text: string }): string {
  return input.value.slice(0, input.start) + input.text + input.value.slice(input.end);
}

function caretAt(value: string, position: number): FormatResult {
  return { value, selectionStart: position, selectionEnd: position };
}

function applyInline(input: FormatInput, markers: { open: string; close: string }): FormatResult {
  const { value, selectionStart: start, selectionEnd: end } = input;
  const { open, close } = markers;
  const surrounded =
    value.slice(start - open.length, start) === open &&
    value.slice(end, end + close.length) === close;
  if (start >= open.length && surrounded) {
    const next = replaceRange({
      value: replaceRange({ value, start: end, end: end + close.length, text: '' }),
      start: start - open.length,
      end: start,
      text: '',
    });
    return {
      value: next,
      selectionStart: start - open.length,
      selectionEnd: end - open.length,
    };
  }
  const chosen = value.slice(start, end);
  const included =
    chosen.length >= open.length + close.length &&
    chosen.startsWith(open) &&
    chosen.endsWith(close);
  if (included) {
    const inner = chosen.slice(open.length, chosen.length - close.length);
    return {
      value: replaceRange({ value, start, end, text: inner }),
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }
  return {
    value: replaceRange({ value, start, end, text: `${open}${chosen}${close}` }),
    selectionStart: start + open.length,
    selectionEnd: end + open.length,
  };
}

function applyLink(input: FormatInput): FormatResult {
  const { value, selectionStart: start, selectionEnd: end } = input;
  const chosen = value.slice(start, end);
  if (chosen === '') {
    const text = `[${LINK_LABEL_PLACEHOLDER}](${LINK_URL_PLACEHOLDER})`;
    return {
      value: replaceRange({ value, start, end, text }),
      selectionStart: start + 1,
      selectionEnd: start + 1 + LINK_LABEL_PLACEHOLDER.length,
    };
  }
  if (URL_SELECTION.test(chosen)) {
    return caretAt(replaceRange({ value, start, end, text: `[](${chosen})` }), start + 1);
  }
  const urlStart = start + chosen.length + 3;
  return {
    value: replaceRange({ value, start, end, text: `[${chosen}](${LINK_URL_PLACEHOLDER})` }),
    selectionStart: urlStart,
    selectionEnd: urlStart + LINK_URL_PLACEHOLDER.length,
  };
}

type LineTransform = (lines: readonly string[]) => string[];

function stripPrefix(line: string, patterns: readonly RegExp[]): string {
  return patterns.reduce((current, pattern) => current.replace(pattern, ''), line);
}

function togglePrefix(input: {
  pattern: RegExp;
  stripOthers: readonly RegExp[];
  prefixFor: (index: number) => string;
}): LineTransform {
  const { pattern, stripOthers, prefixFor } = input;
  return (lines) => {
    const filled = lines.filter((line) => line !== '');
    const removing = filled.length > 0 && filled.every((line) => pattern.test(line));
    if (removing) return lines.map((line) => line.replace(pattern, ''));
    const everyLineEmpty = filled.length === 0;
    let counter = 0;
    return lines.map((line) => {
      if (line === '' && !everyLineEmpty) return line;
      const base = stripPrefix(line, [pattern, ...stripOthers]);
      const prefix = prefixFor(counter);
      counter += 1;
      return `${prefix}${base}`;
    });
  };
}

function headingTransform(level: number | null): LineTransform {
  const marker = level === null ? '' : `${'#'.repeat(level)} `;
  return (lines) => {
    const filled = lines.filter((line) => line !== '');
    const removing =
      level !== null && filled.length > 0 && filled.every((line) => line.startsWith(marker));
    return lines.map((line) => {
      if (line === '' && filled.length > 0) return line;
      const base = line.replace(HEADING_PREFIX, '');
      return removing || level === null ? base : `${marker}${base}`;
    });
  };
}

type LineFormat =
  'bullet' | 'ordered' | 'quote' | 'heading1' | 'heading2' | 'heading3' | 'paragraph';

const LINE_TRANSFORMS: Readonly<Record<LineFormat, LineTransform>> = {
  bullet: togglePrefix({
    pattern: BULLET_PREFIX,
    stripOthers: [ORDERED_PREFIX],
    prefixFor: () => '- ',
  }),
  ordered: togglePrefix({
    pattern: ORDERED_PREFIX,
    stripOthers: [BULLET_PREFIX],
    prefixFor: (index) => `${index + 1}. `,
  }),
  quote: togglePrefix({ pattern: QUOTE_PREFIX, stripOthers: [], prefixFor: () => '> ' }),
  heading1: headingTransform(1),
  heading2: headingTransform(2),
  heading3: headingTransform(3),
  paragraph: headingTransform(null),
};

function applyLines(input: FormatInput, transform: LineTransform): FormatResult {
  const { value, selectionStart: start, selectionEnd: end } = input;
  const touchedEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const newlineAfter = value.indexOf('\n', touchedEnd);
  const lineEnd = newlineAfter === -1 ? value.length : newlineAfter;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const next = transform(lines);
  const firstDelta = (next[0]?.length ?? 0) - (lines[0]?.length ?? 0);
  const totalDelta = next.join('\n').length - (lineEnd - lineStart);
  const selectionStart = Math.max(lineStart, start + firstDelta);
  return {
    value: replaceRange({ value, start: lineStart, end: lineEnd, text: next.join('\n') }),
    selectionStart,
    selectionEnd: Math.max(selectionStart, end + totalDelta),
  };
}

function applyCodeBlock(input: FormatInput): FormatResult {
  const { value, selectionStart: start, selectionEnd: end } = input;
  const lead = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const trail = end < value.length && value[end] !== '\n' ? '\n' : '';
  const chosen = value.slice(start, end);
  const innerStart = start + lead.length + 4;
  return {
    value: replaceRange({ value, start, end, text: `${lead}\`\`\`\n${chosen}\n\`\`\`${trail}` }),
    selectionStart: innerStart,
    selectionEnd: innerStart + chosen.length,
  };
}

function applyDivider(input: FormatInput): FormatResult {
  const { value, selectionEnd: at } = input;
  const before = value.slice(0, at);
  let lead = '\n\n';
  if (before === '' || before.endsWith('\n\n')) lead = '';
  else if (before.endsWith('\n')) lead = '\n';
  const text = `${lead}---\n`;
  return caretAt(replaceRange({ value, start: at, end: at, text }), at + text.length);
}

export function applyFormat(input: FormatInput): FormatResult {
  const { format } = input;
  switch (format) {
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strike':
    case 'code':
      return applyInline(input, INLINE_MARKERS[format]);
    case 'link':
      return applyLink(input);
    case 'codeblock':
      return applyCodeBlock(input);
    case 'divider':
      return applyDivider(input);
    case 'bullet':
    case 'ordered':
    case 'quote':
    case 'heading1':
    case 'heading2':
    case 'heading3':
    case 'paragraph':
      return applyLines(input, LINE_TRANSFORMS[format]);
  }
}

export function diffEdit(input: { before: string; after: string }): TextEdit | null {
  const { before, after } = input;
  if (before === after) return null;
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    start: prefix,
    end: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  };
}
