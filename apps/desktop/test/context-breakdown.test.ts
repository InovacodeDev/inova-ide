import { expect, test } from 'vitest';
import type { ContextSection } from '@inova/core/chat-types';
import {
  categoryLabel,
  isReservedCategory,
  rowParts,
  sectionLabel,
  sectionTotal,
  sortedRows,
} from '../src/renderer/context-breakdown';

const section: ContextSection = {
  title: 'Memory Files',
  columns: ['Type', 'Path', 'Tokens'],
  rows: [
    { cells: ['Project', '/a/CLAUDE.md', '300'], tokens: 300 },
    { cells: ['User', '/b/CLAUDE.md', '?'], tokens: null },
    { cells: ['Project', '/c/RULES.md', '6.1k'], tokens: 6100 },
  ],
};

test('translates known labels and keeps unknown ones', () => {
  expect(categoryLabel('Messages')).toBe('Mensagens');
  expect(categoryLabel('Something new')).toBe('Something new');
  expect(sectionLabel('Memory Files')).toBe('Arquivos de memória');
  expect(sectionLabel('Other')).toBe('Other');
});

test('marks free space and the autocompact buffer as reserved', () => {
  expect(isReservedCategory('Free space')).toBe(true);
  expect(isReservedCategory('Autocompact buffer')).toBe(true);
  expect(isReservedCategory('Messages')).toBe(false);
});

test('sorts rows by tokens with unknown counts last', () => {
  expect(sortedRows(section).map((row) => row.tokens)).toEqual([6100, 300, null]);
});

test('sums known row tokens', () => {
  expect(sectionTotal(section)).toBe(6400);
});

test('splits a row into name and middle detail cells', () => {
  expect(rowParts({ cells: ['Project', '/a/CLAUDE.md', '300'], tokens: 300 })).toEqual({
    name: 'Project',
    detail: '/a/CLAUDE.md',
  });
  expect(rowParts({ cells: ['loop', '~120'], tokens: 120 })).toEqual({ name: 'loop', detail: '' });
});
