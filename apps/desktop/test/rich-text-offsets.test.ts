import { describe, expect, test } from 'vitest';
import {
  flattenRichText,
  locateOffset,
  offsetOfPosition,
  plainTextOf,
} from '../src/renderer/rich-text-offsets';
import { parseHtml } from './fake-dom';

describe('plainTextOf', () => {
  test.each([
    ['inline formatting is transparent', '<b>a</b><i>b</i>', 'ab'],
    ['br is a newline', 'a<br>b', 'a\nb'],
    ['trailing br is a placeholder', 'a<br>', 'a'],
    ['two trailing brs keep one newline', '<div>a<br><br></div>', 'a\n'],
    ['divs are lines', 'a<div>b</div><div>c</div>', 'a\nb\nc'],
    ['empty div is an empty line', 'a<div><br></div><div>b</div>', 'a\n\nb'],
    ['leading empty div', '<div><br></div><div>b</div>', '\nb'],
    ['text after a block', '<div>a</div>b', 'a\nb'],
    ['list items are lines', '<ul><li>a</li><li>b</li></ul>', 'a\nb'],
    ['nested list items', '<ul><li>a<ul><li>b</li></ul></li></ul>', 'a\nb'],
    ['text before a list', 'x<ul><li>a</li></ul>', 'x\na'],
    ['quote with text', 'x<blockquote>q</blockquote>', 'x\nq'],
    ['headings are lines', '<h1>t</h1><div>b</div>', 't\nb'],
    ['nbsp and zero width map to spaces', 'a&nbsp;b​c', 'a b c'],
    ['pre keeps its own newlines', '<pre>a\nb</pre>', 'a\nb'],
  ])('%s', (_label, html, expected) => {
    expect(plainTextOf(parseHtml(html))).toBe(expected);
  });
});

describe('offset mapping', () => {
  const trees = [
    'hello',
    '<b>he</b>llo <i>there</i>',
    'a<br>b',
    'a<br><br>b',
    '<div>a<br><br></div>',
    'a<div>b</div><div>c</div>',
    'a<div><br></div><div>b</div>',
    '<div><br></div><div>b</div>',
    '<div>a</div>b',
    '<ul><li>one</li><li>two</li></ul>',
    'x<ul><li>a<ul><li>b</li></ul></li></ul>',
    '<h1>t</h1><blockquote>q</blockquote><pre>c</pre>',
    '<a href="https://x.dev">go</a> now',
  ];

  test.each(trees)('every offset survives locate then offsetOf: %s', (html) => {
    const root = parseHtml(html);
    const flat = flattenRichText(root);
    for (let offset = 0; offset <= flat.text.length; offset += 1) {
      const position = locateOffset({ flat, root, offset });
      expect(offsetOfPosition({ flat, position })).toBe(offset);
    }
  });

  test('locates inside a text node', () => {
    const root = parseHtml('<b>ab</b>cd');
    const flat = flattenRichText(root);
    const position = locateOffset({ flat, root, offset: 1 });
    expect(position.node.textContent).toBe('ab');
    expect(position.offset).toBe(1);
  });

  test('prefers the end of the earlier text at a boundary', () => {
    const root = parseHtml('<b>ab</b>cd');
    const flat = flattenRichText(root);
    const position = locateOffset({ flat, root, offset: 2 });
    expect(position.node.textContent).toBe('ab');
    expect(position.offset).toBe(2);
  });

  test('clamps offsets outside the text', () => {
    const root = parseHtml('abc');
    const flat = flattenRichText(root);
    expect(offsetOfPosition({ flat, position: locateOffset({ flat, root, offset: 99 }) })).toBe(3);
    expect(offsetOfPosition({ flat, position: locateOffset({ flat, root, offset: -4 }) })).toBe(0);
  });

  test('maps an element position to the start of that child', () => {
    const root = parseHtml('a<div>b</div>');
    const flat = flattenRichText(root);
    expect(offsetOfPosition({ flat, position: { node: root, offset: 1 } })).toBe(2);
    expect(offsetOfPosition({ flat, position: { node: root, offset: 2 } })).toBe(3);
  });
});
