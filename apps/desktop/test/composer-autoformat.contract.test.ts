import { describe, expect, test } from 'vitest';
import { detectBlockAutoformat, detectInlineAutoformat } from '../src/renderer/composer-autoformat';
import { markdownToHtml } from '../src/renderer/rich-markdown';

const typed = (before: string) => detectInlineAutoformat({ before, after: '' });

describe('contract: inline autoformat (Slack style)', () => {
  test('closing backtick turns the text into code', () => {
    expect(typed('veja `npm test`')).toEqual({
      format: 'code',
      start: 5,
      openLength: 1,
      closeLength: 1,
      inner: 'npm test',
    });
  });

  test('single star is bold, double star is bold', () => {
    expect(typed('*oi*')).toMatchObject({ format: 'bold', openLength: 1, inner: 'oi' });
    expect(typed('**oi**')).toMatchObject({ format: 'bold', openLength: 2, inner: 'oi' });
  });

  test('underscore is italic and tilde is strike', () => {
    expect(typed('_oi_')).toMatchObject({ format: 'italic', inner: 'oi' });
    expect(typed('~oi~')).toMatchObject({ format: 'strike', openLength: 1 });
    expect(typed('~~oi~~')).toMatchObject({ format: 'strike', openLength: 2 });
  });

  test('opening delimiter sits at line start or after a space', () => {
    expect(typed('a *b*')).toMatchObject({ start: 2 });
    expect(typed('a*b*')).toBeNull();
  });

  test('inner text is not empty and has no space at the edges', () => {
    expect(typed('``')).toBeNull();
    expect(typed('* a*')).toBeNull();
    expect(typed('*a *')).toBeNull();
  });

  test('snake_case and dunder names do not become italic', () => {
    expect(typed('snake_case_')).toBeNull();
    expect(typed('__init__')).toBeNull();
  });

  test('the converted span covers only the delimiter pair', () => {
    const hit = typed('antes *meio*');
    expect(hit).not.toBeNull();
    expect('antes *meio*'.slice(0, hit!.start)).toBe('antes ');
  });
});

describe('contract: block autoformat', () => {
  test('marker plus space at line start opens a block', () => {
    expect(detectBlockAutoformat('- ')).toEqual({ format: 'bullet', consume: 2 });
    expect(detectBlockAutoformat('* ')).toEqual({ format: 'bullet', consume: 2 });
    expect(detectBlockAutoformat('1. ')).toEqual({ format: 'ordered', consume: 3 });
    expect(detectBlockAutoformat('> ')).toEqual({ format: 'quote', consume: 2 });
    expect(detectBlockAutoformat('```')).toEqual({ format: 'codeblock', consume: 3 });
  });
});

describe('contract: round trip with the markdown renderer', () => {
  test('literal markers render to the same tags the autoformat produces', () => {
    expect(markdownToHtml('`x`')).toContain('<code>x</code>');
    expect(markdownToHtml('**x**')).toContain('<b>x</b>');
    expect(markdownToHtml('~~x~~')).toContain('<s>x</s>');
  });
});
