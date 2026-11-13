import { describe, expect, test } from 'vitest';
import { markdownToHtml, normalizeLinkUrl, serializeMarkdown } from '../src/renderer/rich-markdown';
import { el, parseHtml, tag, text } from './fake-dom';

const roundTrip = (markdown: string): string =>
  serializeMarkdown(parseHtml(markdownToHtml(markdown)));

const fromHtml = (html: string): string => serializeMarkdown(parseHtml(html));

describe('round trip markdown -> html -> markdown', () => {
  test.each([
    ['plain text', 'just text'],
    ['bold', '**bold**'],
    ['italic', '_italic_'],
    ['underline', '<u>under</u>'],
    ['strike', '~~gone~~'],
    ['inline code', 'use `pnpm test` now'],
    ['link', 'see [docs](https://example.com/a?b=1)'],
    ['mailto link', '[me](mailto:me@example.com)'],
    ['bold inside italic', '_**both**_'],
    ['italic inside bold', '**_both_**'],
    ['mixed inline', '**a** and _b_ with `c` and ~~d~~'],
    ['lines', 'one\ntwo\nthree'],
    ['blank line between paragraphs', 'one\n\ntwo'],
    ['heading 1', '# Title'],
    ['heading 2', '## Title'],
    ['heading 3', '### Title'],
    ['bullet list', '- a\n- b\n- c'],
    ['ordered list', '1. a\n2. b\n3. c'],
    ['nested bullet list', '- a\n  - b\n  - c\n- d'],
    ['bullet nested in ordered list', '1. a\n   - b\n2. c'],
    ['list with formatting', '- **bold** item\n- _it_ item'],
    ['quote', '> quoted'],
    ['multi line quote', '> a\n> b'],
    ['list inside quote', '> - a\n> - b'],
    ['code block', '```\nconst a = 1;\nconst b = 2;\n```'],
    ['code block with blank line', '```\na\n\nb\n```'],
    ['code block keeps markers literal', '```\n**not bold** <b>\n```'],
    ['divider', 'a\n---\nb'],
    ['block sequence', '# T\n\n- a\n- b\n\n> q\n\n```\nx\n```'],
    ['html-like text stays literal', 'if a < b && c > d then <div>'],
    ['snake case is not italic', 'call snake_case_name here'],
  ])('%s', (_label, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test('empty markdown gives empty html', () => {
    expect(markdownToHtml('')).toBe('');
  });
});

describe('parser', () => {
  test('escapes html in text', () => {
    const html = markdownToHtml('<script>alert(1)</script> & **<b>x</b>**');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('<b>&lt;b&gt;x&lt;/b&gt;</b>');
  });

  test('does not turn unsafe urls into links', () => {
    expect(markdownToHtml('[x](javascript:alert(1))')).not.toContain('<a');
  });

  test('keeps unmatched markers literal', () => {
    expect(roundTrip('**open and _single')).toBe('**open and _single');
  });

  test('renders structural tags', () => {
    expect(markdownToHtml('- a')).toBe('<ul><li>a</li></ul>');
    expect(markdownToHtml('1. a')).toBe('<ol><li>a</li></ol>');
    expect(markdownToHtml('# h')).toBe('<h1>h</h1>');
    expect(markdownToHtml('---')).toBe('<hr>');
    expect(markdownToHtml('> q')).toBe('<blockquote><div>q</div></blockquote>');
  });
});

describe('serializer edge cases', () => {
  test('maps every inline tag', () => {
    expect(fromHtml('<strong>a</strong> <em>b</em> <strike>c</strike> <del>d</del>')).toBe(
      '**a** _b_ ~~c~~ ~~d~~',
    );
  });

  test('merges adjacent siblings with the same format', () => {
    expect(fromHtml('<b>a</b><b>b</b>')).toBe('**ab**');
    expect(fromHtml('<b>a</b><strong>b</strong>')).toBe('**ab**');
    expect(fromHtml('<i>a</i><i>b</i>')).toBe('_ab_');
    expect(fromHtml('<u>a</u><u>b</u>')).toBe('<u>ab</u>');
    expect(fromHtml('<s>a</s><strike>b</strike>')).toBe('~~ab~~');
    expect(fromHtml('<code>a</code><code>b</code>')).toBe('`ab`');
    expect(fromHtml('<b>a</b>​<b>b</b>')).toBe('**ab**');
    expect(fromHtml('<b><i>a</i><i>b</i></b>')).toBe('**_ab_**');
    expect(fromHtml('<b>a</b><b>b</b> <b>c</b>')).toBe('**ab** **c**');
    expect(fromHtml('<a href="https://x.dev">a</a><a href="https://x.dev">b</a>')).toBe(
      '[ab](https://x.dev)',
    );
    expect(fromHtml('<a href="https://x.dev">a</a><a href="https://y.dev">b</a>')).toBe(
      '[a](https://x.dev)[b](https://y.dev)',
    );
    expect(fromHtml('<b>a</b><i>b</i>')).toBe('**a**_b_');
  });

  test('nests bold and italic', () => {
    expect(fromHtml('<b><i>x</i></b>')).toBe('**_x_**');
  });

  test('drops empty formatting nodes', () => {
    expect(fromHtml('a<b></b><i> </i><u></u>b')).toBe('a b');
    expect(fromHtml('<b></b>')).toBe('');
  });

  test('keeps spaces outside the markers', () => {
    expect(fromHtml('<b> a </b>')).toBe(' **a** ');
  });

  test('ignores a trailing br', () => {
    expect(fromHtml('a<br>')).toBe('a');
    expect(fromHtml('<div>a<br></div>')).toBe('a');
  });

  test('keeps a real line break', () => {
    expect(fromHtml('a<br>b')).toBe('a\nb');
    expect(fromHtml('<div>a<br><br></div><div>b</div>')).toBe('a\n\nb');
  });

  test('turns nbsp and zero width spaces into text', () => {
    expect(fromHtml('a&nbsp;b')).toBe('a b');
    expect(fromHtml(`<code>${'​'}x</code>`)).toBe('`x`');
    expect(fromHtml(`<code>${'​'}</code>`)).toBe('');
  });

  test('handles chromium div line wrappers', () => {
    expect(fromHtml('a<div>b</div><div><br></div><div>c</div>')).toBe('a\nb\n\nc');
    expect(fromHtml('<div>a</div><div><br></div>')).toBe('a');
    expect(fromHtml('<div><br></div><div>b</div>')).toBe('\nb');
  });

  test('serializes links with and without href', () => {
    expect(fromHtml('<a href="https://x.dev">go</a>')).toBe('[go](https://x.dev)');
    expect(serializeMarkdown(tag('div', tag('a', 'plain')))).toBe('plain');
    expect(serializeMarkdown(tag('div', el('a', { href: 'https://x.dev' }, tag('b', 'go'))))).toBe(
      '[**go**](https://x.dev)',
    );
  });

  test('passes unknown inline wrappers through', () => {
    expect(fromHtml('<span>a <font>b</font></span>')).toBe('a b');
  });

  test('skips empty list items and empty quotes', () => {
    expect(fromHtml('<ul><li><br></li></ul>')).toBe('');
    expect(fromHtml('<blockquote><br></blockquote>')).toBe('');
    expect(fromHtml('<ul><li>a</li><li><br></li><li>b</li></ul>')).toBe('- a\n- b');
    expect(fromHtml('<ol><li>a</li><li><br></li><li>b</li></ol>')).toBe('1. a\n2. b');
  });

  test('indents continuation lines of a list item', () => {
    expect(fromHtml('<ul><li>a<br>b</li><li>c</li></ul>')).toBe('- a\n  b\n- c');
  });

  test('serializes nested lists made by chromium', () => {
    expect(fromHtml('<ul><li>a<ul><li>b</li></ul></li></ul>')).toBe('- a\n  - b');
  });

  test('serializes pre with br lines', () => {
    expect(fromHtml('<pre>a<br>b</pre>')).toBe('```\na\nb\n```');
    expect(fromHtml('<pre><br></pre>')).toBe('');
  });

  test('serializes headings on one line', () => {
    expect(fromHtml('<h2>a<br>b</h2>')).toBe('## a b');
    expect(fromHtml('<h1><b>x</b></h1>')).toBe('# **x**');
  });

  test('builds from a hand made tree', () => {
    const tree = tag('div', text('x'), tag('hr'), tag('div', 'y'));
    expect(serializeMarkdown(tree)).toBe('x\n---\ny');
  });
});

describe('normalizeLinkUrl', () => {
  test('accepts http, https and mailto', () => {
    expect(normalizeLinkUrl('https://a.dev/x')).toBe('https://a.dev/x');
    expect(normalizeLinkUrl(' http://a.dev ')).toBe('http://a.dev');
    expect(normalizeLinkUrl('mailto:a@b.dev')).toBe('mailto:a@b.dev');
  });

  test('adds https to a bare host', () => {
    expect(normalizeLinkUrl('example.com/path')).toBe('https://example.com/path');
  });

  test('rejects unsafe or malformed values', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('')).toBeNull();
    expect(normalizeLinkUrl('two words')).toBeNull();
    expect(normalizeLinkUrl('ftp://a.dev')).toBeNull();
  });
});
