import { describe, expect, test } from 'vitest';
import { detectBlockAutoformat, detectInlineAutoformat } from '../src/renderer/composer-autoformat';

const typed = (before: string, after = '') => detectInlineAutoformat({ before, after });

describe('edge: inline autoformat', () => {
  test('file mentions and paths keep their text', () => {
    expect(typed('@src/a_b_')).toBeNull();
    expect(typed('/tmp/a_b_')).toBeNull();
    expect(typed('veja @a_b_')).toBeNull();
    expect(typed('https://x.com/a_b_')).toBeNull();
  });

  test('a tilde or star inside a token does not convert', () => {
    expect(typed('a~b~')).toBeNull();
    expect(typed('2*3*')).toBeNull();
  });

  test('first star of a double star does not convert early', () => {
    expect(typed('**bold*')).toBeNull();
  });

  test('typing a closer in the middle of a word does not convert', () => {
    expect(typed('*a*', 'bc')).toBeNull();
    expect(typed('*a*', ' bc')).not.toBeNull();
  });

  test('inner text cannot contain its own delimiter', () => {
    expect(typed('`a`b`')).toBeNull();
    expect(typed('*a*b*')).toBeNull();
  });

  test('accepts opening after bracket or quote', () => {
    expect(typed('(*a*')).toMatchObject({ start: 1 });
    expect(typed('"_a_')).toMatchObject({ start: 1 });
  });

  test('the caret anchor left after a formatted span counts as a boundary', () => {
    expect(typed('​*a*')).toMatchObject({ start: 1, format: 'bold' });
  });

  test('unicode letters count as word characters', () => {
    expect(typed('ação_x_')).toBeNull();
    expect(typed('ação _x_')).toMatchObject({ format: 'italic' });
  });

  test('empty and delimiter-only text returns null', () => {
    expect(typed('')).toBeNull();
    expect(typed('*')).toBeNull();
    expect(typed('**')).toBeNull();
    expect(typed('~~')).toBeNull();
  });
});

describe('edge: block autoformat', () => {
  test('text before the marker does not open a block', () => {
    expect(detectBlockAutoformat('a - ')).toBeNull();
    expect(detectBlockAutoformat('-')).toBeNull();
    expect(detectBlockAutoformat('1.')).toBeNull();
    expect(detectBlockAutoformat('1) ')).toBeNull();
    expect(detectBlockAutoformat('``')).toBeNull();
  });

  test('long numbers still open an ordered list, absurd ones do not', () => {
    expect(detectBlockAutoformat('12. ')).toEqual({ format: 'ordered', consume: 4 });
    expect(detectBlockAutoformat('1234567890. ')).toBeNull();
  });
});
