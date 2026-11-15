import { describe, expect, it } from 'vitest';
import { categoryFromFsError } from './shared.js';

describe('categoryFromFsError', () => {
  it('maps an error with a string code to a category error', () => {
    const error = Object.assign(new Error('boom'), { code: 'EACCES' });
    expect(categoryFromFsError({ kind: 'skill', message: 'Falhou', error })).toEqual({
      kind: 'skill',
      items: [],
      error: 'Falhou (EACCES).',
    });
  });

  it('rethrows errors without a string code', () => {
    const error = new SyntaxError('bad');
    expect(() => categoryFromFsError({ kind: 'mcp', message: 'x', error })).toThrow(error);
    expect(() => categoryFromFsError({ kind: 'mcp', message: 'x', error: 'text' })).toThrow();
  });
});
