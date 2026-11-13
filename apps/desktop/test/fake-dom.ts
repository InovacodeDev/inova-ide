import type { RichNode } from '../src/renderer/rich-markdown';

export class FakeNode implements RichNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly childNodes: FakeNode[];
  private readonly data: string;
  private readonly attributes: Record<string, string>;

  constructor(input: {
    nodeType: number;
    nodeName: string;
    data?: string;
    childNodes?: FakeNode[];
    attributes?: Record<string, string>;
  }) {
    this.nodeType = input.nodeType;
    this.nodeName = input.nodeName;
    this.data = input.data ?? '';
    this.childNodes = input.childNodes ?? [];
    this.attributes = input.attributes ?? {};
  }

  get textContent(): string {
    if (this.nodeType === 3) return this.data;
    return this.childNodes.map((child) => child.textContent).join('');
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
}

export function text(data: string): FakeNode {
  return new FakeNode({ nodeType: 3, nodeName: '#text', data });
}

export function el(
  name: string,
  attributes: Record<string, string>,
  ...children: (FakeNode | string)[]
): FakeNode {
  return new FakeNode({
    nodeType: 1,
    nodeName: name.toUpperCase(),
    attributes,
    childNodes: children.map((child) => (typeof child === 'string' ? text(child) : child)),
  });
}

export function tag(name: string, ...children: (FakeNode | string)[]): FakeNode {
  return el(name, {}, ...children);
}

const VOID_TAGS = new Set(['br', 'hr']);
const TOKEN = /<(\/?)([a-z0-9]+)((?:\s+[a-z-]+="[^"]*")*)\s*>|([^<]+)/gi;
const ATTRIBUTE = /([a-z-]+)="([^"]*)"/gi;

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const [, key, value] = match;
    if (key !== undefined && value !== undefined) attributes[key] = decodeEntities(value);
  }
  return attributes;
}

export function parseHtml(html: string): FakeNode {
  const root = tag('div');
  const stack: FakeNode[] = [root];
  for (const match of html.matchAll(TOKEN)) {
    const [, closing, rawName, rawAttributes, content] = match;
    const top = stack[stack.length - 1];
    if (top === undefined) throw new Error('unbalanced html');
    if (content !== undefined) {
      top.childNodes.push(text(decodeEntities(content)));
    } else if (closing === '/') {
      stack.pop();
    } else if (rawName !== undefined) {
      const node = el(rawName, parseAttributes(rawAttributes ?? ''));
      top.childNodes.push(node);
      if (!VOID_TAGS.has(rawName.toLowerCase())) stack.push(node);
    }
  }
  return root;
}
