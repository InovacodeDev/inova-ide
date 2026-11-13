export interface RichNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly textContent: string | null;
  readonly childNodes: ArrayLike<RichNode>;
  getAttribute?(name: string): string | null;
}

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;

const LINE_BLOCKS: ReadonlySet<string> = new Set(['div', 'p', 'h1', 'h2', 'h3', 'pre', 'hr', 'li']);
const CONTAINER_BLOCKS: ReadonlySet<string> = new Set(['ul', 'ol', 'blockquote']);
const HEADING_LEVELS: Readonly<Record<string, number>> = { h1: 1, h2: 2, h3: 3 };

export function nodeNameOf(node: RichNode): string {
  return node.nodeName.toLowerCase();
}

export function childrenOf(node: RichNode): RichNode[] {
  return Array.from(node.childNodes);
}

export function isElementNode(node: RichNode): boolean {
  return node.nodeType === ELEMENT_NODE;
}

export function isTextNode(node: RichNode): boolean {
  return node.nodeType === TEXT_NODE;
}

export function isLineBlock(node: RichNode): boolean {
  return isElementNode(node) && LINE_BLOCKS.has(nodeNameOf(node));
}

export function isContainerBlock(node: RichNode): boolean {
  return isElementNode(node) && CONTAINER_BLOCKS.has(nodeNameOf(node));
}

function isBlock(node: RichNode): boolean {
  return isLineBlock(node) || isContainerBlock(node);
}

function normalizeText(text: string): string {
  return text.replace(/\u200b/g, '').replace(/\u00a0/g, ' ');
}

function wrapMarks(input: { inner: string; open: string; close: string }): string {
  const { inner, open, close } = input;
  // REGEX: split surrounding spaces/tabs from the content so markers hug the text
  const parts = /^([ \t]*)([\s\S]*?)([ \t]*)$/.exec(inner);
  const lead = parts?.[1] ?? '';
  const core = parts?.[2] ?? inner;
  const trail = parts?.[3] ?? '';
  if (core.trim() === '') return inner;
  return `${lead}${open}${core}${close}${trail}`;
}

function serializeInlineNode(node: RichNode): string {
  if (isTextNode(node)) return normalizeText(node.textContent ?? '');
  if (!isElementNode(node)) return '';
  const inner = () => serializeInline(childrenOf(node));
  switch (nodeNameOf(node)) {
    case 'br':
      return '\n';
    case 'b':
    case 'strong':
      return wrapMarks({ inner: inner(), open: '**', close: '**' });
    case 'i':
    case 'em':
      return wrapMarks({ inner: inner(), open: '_', close: '_' });
    case 'u':
      return wrapMarks({ inner: inner(), open: '<u>', close: '</u>' });
    case 's':
    case 'strike':
    case 'del':
      return wrapMarks({ inner: inner(), open: '~~', close: '~~' });
    case 'code':
      return wrapMarks({
        inner: normalizeText(node.textContent ?? '').replace(/\n/g, ' '),
        open: '`',
        close: '`',
      });
    case 'a': {
      const href = node.getAttribute?.('href') ?? '';
      const label = inner();
      return href === '' || label.trim() === '' ? label : `[${label}](${href})`;
    }
    default:
      return inner();
  }
}

const MARK_KEYS: Readonly<Record<string, string>> = {
  b: 'b',
  strong: 'b',
  i: 'i',
  em: 'i',
  u: 'u',
  s: 's',
  strike: 's',
  del: 's',
  code: 'code',
};

function markKey(node: RichNode): string | null {
  if (!isElementNode(node)) return null;
  const name = nodeNameOf(node);
  if (name === 'a') {
    const href = node.getAttribute?.('href') ?? '';
    return href === '' ? null : `a:${href}`;
  }
  return MARK_KEYS[name] ?? null;
}

function mergeSiblings(group: readonly RichNode[]): RichNode {
  const [first] = group;
  if (first === undefined) throw new Error('empty group');
  return {
    nodeType: first.nodeType,
    nodeName: first.nodeName,
    textContent: group.map((node) => node.textContent ?? '').join(''),
    childNodes: group.flatMap(childrenOf),
    ...(first.getAttribute === undefined
      ? {}
      : { getAttribute: (name: string) => first.getAttribute?.(name) ?? null }),
  };
}

function serializeInline(nodes: readonly RichNode[]): string {
  const parts: string[] = [];
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index];
    if (node === undefined) break;
    const key = markKey(node);
    const group = [node];
    let cursor = index + 1;
    while (key !== null && cursor < nodes.length) {
      const next = nodes[cursor];
      if (next === undefined) break;
      if (isEmptyText(next)) {
        cursor += 1;
      } else if (markKey(next) === key) {
        group.push(next);
        cursor += 1;
      } else {
        break;
      }
    }
    parts.push(serializeInlineNode(group.length === 1 ? node : mergeSiblings(group)));
    index = cursor;
  }
  return parts.join('');
}

function isEmptyText(node: RichNode): boolean {
  return isTextNode(node) && normalizeText(node.textContent ?? '') === '';
}

function inlineRunLines(run: readonly RichNode[]): string[] {
  const nodes = run.filter((node) => !isEmptyText(node));
  const last = nodes[nodes.length - 1];
  if (last === undefined) return [];
  if (isElementNode(last) && nodeNameOf(last) === 'br') {
    if (nodes.length === 1) return [''];
    return serializeInline(nodes.slice(0, -1)).split('\n');
  }
  return serializeInline(nodes).split('\n');
}

function preText(node: RichNode): string {
  return childrenOf(node)
    .map((child) => {
      if (isTextNode(child)) return normalizeText(child.textContent ?? '');
      if (!isElementNode(child)) return '';
      const name = nodeNameOf(child);
      if (name === 'br') return '\n';
      const inner = preText(child);
      return isLineBlock(child) ? `${inner}\n` : inner;
    })
    .join('');
}

function serializeList(node: RichNode): string[] {
  const ordered = nodeNameOf(node) === 'ol';
  const lines: string[] = [];
  let counter = 0;
  for (const child of childrenOf(node)) {
    if (!isElementNode(child)) continue;
    if (nodeNameOf(child) !== 'li') {
      lines.push(...serializeBlock(child).map((line) => (line === '' ? '' : `  ${line}`)));
      continue;
    }
    const itemLines = serializeBlocks(childrenOf(child));
    if (itemLines.every((line) => line === '')) continue;
    counter += 1;
    const marker = ordered ? `${counter}. ` : '- ';
    const padding = ' '.repeat(marker.length);
    const [first = '', ...rest] = itemLines;
    lines.push(
      `${marker}${first}`,
      ...rest.map((line) => (line === '' ? '' : `${padding}${line}`)),
    );
  }
  return lines;
}

function serializeBlock(node: RichNode): string[] {
  const name = nodeNameOf(node);
  const level = HEADING_LEVELS[name];
  if (level !== undefined) {
    const text = serializeInline(childrenOf(node)).replace(/\n/g, ' ');
    return text.trim() === '' ? [''] : [`${'#'.repeat(level)} ${text}`];
  }
  switch (name) {
    case 'hr':
      return ['---'];
    case 'pre': {
      const text = preText(node).replace(/\n+$/, '');
      return text.trim() === '' ? [] : ['```', ...text.split('\n'), '```'];
    }
    case 'blockquote': {
      const inner = serializeBlocks(childrenOf(node));
      if (inner.every((line) => line === '')) return [];
      return inner.map((line) => (line === '' ? '>' : `> ${line}`));
    }
    case 'ul':
    case 'ol':
      return serializeList(node);
    default:
      return serializeBlocks(childrenOf(node));
  }
}

function serializeBlocks(nodes: readonly RichNode[]): string[] {
  const lines: string[] = [];
  let run: RichNode[] = [];
  const flush = () => {
    lines.push(...inlineRunLines(run));
    run = [];
  };
  for (const node of nodes) {
    if (isBlock(node)) {
      flush();
      lines.push(...serializeBlock(node));
    } else {
      run.push(node);
    }
  }
  flush();
  return lines;
}

export function serializeMarkdown(root: RichNode): string {
  return serializeBlocks(childrenOf(root)).join('\n').replace(/\n+$/, '');
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

// REGEX: http(s) or mailto URL without whitespace
const SAFE_URL = /^(https?:\/\/|mailto:)\S+$/i;
// REGEX: bare host such as example.com/path, no scheme and no colon before the first dot
const BARE_HOST = /^[^\s:/]+\.\S+$/;

export function normalizeLinkUrl(raw: string): string | null {
  const url = raw.trim();
  if (SAFE_URL.test(url)) return url;
  if (BARE_HOST.test(url)) {
    const prefixed = `https://${url}`;
    return SAFE_URL.test(prefixed) ? prefixed : null;
  }
  return null;
}

// REGEX: inline link [label](url) anchored at the current index
const LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/y;
const WORD_CHAR = /[A-Za-z0-9_]/;

interface InlineToken {
  html: string;
  end: number;
}

function delimited(input: {
  text: string;
  index: number;
  open: string;
  close: string;
}): { inner: string; end: number } | null {
  const { text, index, open, close } = input;
  const closeAt = text.indexOf(close, index + open.length);
  if (closeAt <= index + open.length) return null;
  return { inner: text.slice(index + open.length, closeAt), end: closeAt + close.length };
}

function matchItalic(text: string, index: number): InlineToken | null {
  const previous = text[index - 1];
  if (previous !== undefined && WORD_CHAR.test(previous)) return null;
  const first = text[index + 1];
  if (first === undefined || /\s/.test(first)) return null;
  for (let cursor = index + 2; cursor < text.length; cursor += 1) {
    if (text[cursor] !== '_') continue;
    const before = text[cursor - 1] ?? '';
    const after = text[cursor + 1];
    if (/\s/.test(before) || (after !== undefined && WORD_CHAR.test(after))) continue;
    return {
      html: `<i>${renderInline(text.slice(index + 1, cursor))}</i>`,
      end: cursor + 1,
    };
  }
  return null;
}

function matchLink(text: string, index: number): InlineToken | null {
  LINK_PATTERN.lastIndex = index;
  const found = LINK_PATTERN.exec(text);
  const label = found?.[1];
  const url = found?.[2];
  if (found === null || label === undefined || url === undefined || !SAFE_URL.test(url)) {
    return null;
  }
  return {
    html: `<a href="${escapeAttribute(url)}">${renderInline(label)}</a>`,
    end: index + found[0].length,
  };
}

function matchWrapped(input: {
  text: string;
  index: number;
  marks: { open: string; close: string; tag: string; literal: boolean };
}): InlineToken | null {
  const { text, index, marks } = input;
  const found = delimited({ text, index, open: marks.open, close: marks.close });
  if (found === null) return null;
  const body = marks.literal ? escapeHtml(found.inner) : renderInline(found.inner);
  return { html: `<${marks.tag}>${body}</${marks.tag}>`, end: found.end };
}

function matchToken(text: string, index: number): InlineToken | null {
  const char = text[index];
  if (char === '`') {
    return matchWrapped({
      text,
      index,
      marks: { open: '`', close: '`', tag: 'code', literal: true },
    });
  }
  if (text.startsWith('**', index)) {
    return matchWrapped({
      text,
      index,
      marks: { open: '**', close: '**', tag: 'b', literal: false },
    });
  }
  if (text.startsWith('~~', index)) {
    return matchWrapped({
      text,
      index,
      marks: { open: '~~', close: '~~', tag: 's', literal: false },
    });
  }
  if (text.startsWith('<u>', index)) {
    return matchWrapped({
      text,
      index,
      marks: { open: '<u>', close: '</u>', tag: 'u', literal: false },
    });
  }
  if (char === '_') return matchItalic(text, index);
  if (char === '[') return matchLink(text, index);
  return null;
}

function renderInline(text: string): string {
  let html = '';
  let index = 0;
  while (index < text.length) {
    const token = matchToken(text, index);
    if (token === null) {
      html += escapeHtml(text.charAt(index));
      index += 1;
    } else {
      html += token.html;
      index = token.end;
    }
  }
  return html;
}

// REGEX: list item marker at the start of a line: "- " or "1. "
const LIST_ITEM = /^(- |\d+\. )(.*)$/;
const FENCE_OPEN = /^```/;
const FENCE_CLOSE = /^```\s*$/;
const RULE = /^---\s*$/;
const HEADING = /^(#{1,3}) (.*)$/;
const QUOTE = /^>( ?)(.*)$/;

function renderFence(lines: readonly string[], start: number): { html: string; next: number } {
  const body: string[] = [];
  let cursor = start + 1;
  while (cursor < lines.length && !FENCE_CLOSE.test(lines[cursor] ?? '')) {
    body.push(lines[cursor] ?? '');
    cursor += 1;
  }
  const content = body.length === 0 ? '<br>' : body.map(escapeHtml).join('<br>');
  return { html: `<pre>${content}</pre>`, next: cursor + 1 };
}

function renderQuote(lines: readonly string[], start: number): { html: string; next: number } {
  const inner: string[] = [];
  let cursor = start;
  while (cursor < lines.length) {
    const found = QUOTE.exec(lines[cursor] ?? '');
    if (found === null) break;
    inner.push(found[2] ?? '');
    cursor += 1;
  }
  return { html: `<blockquote>${renderBlocks(inner)}</blockquote>`, next: cursor };
}

function renderList(lines: readonly string[], start: number): { html: string; next: number } {
  const ordered = !(lines[start] ?? '').startsWith('- ');
  const items: string[] = [];
  let cursor = start;
  while (cursor < lines.length) {
    const found = LIST_ITEM.exec(lines[cursor] ?? '');
    const marker = found?.[1];
    if (found === null || marker === undefined || marker.startsWith('- ') === ordered) break;
    const nested: string[] = [];
    const strip = new RegExp(`^ {1,${marker.length}}`);
    cursor += 1;
    while (cursor < lines.length && (lines[cursor] ?? '').startsWith(' ')) {
      nested.push((lines[cursor] ?? '').replace(strip, ''));
      cursor += 1;
    }
    const first = found[2] ?? '';
    const head = first === '' && nested.length === 0 ? '<br>' : renderInline(first);
    items.push(`<li>${head}${renderBlocks(nested)}</li>`);
  }
  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}>${items.join('')}</${tag}>`, next: cursor };
}

function renderBlocks(lines: readonly string[]): string {
  const parts: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const heading = HEADING.exec(line);
    if (FENCE_OPEN.test(line)) {
      const block = renderFence(lines, index);
      parts.push(block.html);
      index = block.next;
    } else if (QUOTE.test(line)) {
      const block = renderQuote(lines, index);
      parts.push(block.html);
      index = block.next;
    } else if (LIST_ITEM.test(line)) {
      const block = renderList(lines, index);
      parts.push(block.html);
      index = block.next;
    } else if (RULE.test(line)) {
      parts.push('<hr>');
      index += 1;
    } else if (heading !== null) {
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? '';
      parts.push(`<h${level}>${text === '' ? '<br>' : renderInline(text)}</h${level}>`);
      index += 1;
    } else {
      parts.push(`<div>${line === '' ? '<br>' : renderInline(line)}</div>`);
      index += 1;
    }
  }
  return parts.join('');
}

export function markdownToHtml(markdown: string): string {
  if (markdown === '') return '';
  return renderBlocks(markdown.replace(/\r\n?/g, '\n').split('\n'));
}
