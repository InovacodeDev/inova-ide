import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  filterSheetRows,
  findTextMatches,
  formatFileSize,
  spreadsheetColumnLabel,
} from '../src/renderer/file-viewer-format';

describe('file-viewer-format', () => {
  describe('spreadsheetColumnLabel', () => {
    it('formats single letter column labels', () => {
      expect(spreadsheetColumnLabel(0)).toBe('A');
      expect(spreadsheetColumnLabel(1)).toBe('B');
      expect(spreadsheetColumnLabel(25)).toBe('Z');
    });

    it('formats two and three letter column labels', () => {
      expect(spreadsheetColumnLabel(26)).toBe('AA');
      expect(spreadsheetColumnLabel(27)).toBe('AB');
      expect(spreadsheetColumnLabel(51)).toBe('AZ');
      expect(spreadsheetColumnLabel(52)).toBe('BA');
      expect(spreadsheetColumnLabel(701)).toBe('ZZ');
      expect(spreadsheetColumnLabel(702)).toBe('AAA');
    });
  });

  describe('findTextMatches', () => {
    const text = 'First line\nSecond line with keyword\nTHIRD LINE with KEYWORD\nFourth line';

    it('returns empty array when query is empty or whitespace', () => {
      expect(findTextMatches({ text, query: '' })).toEqual([]);
      expect(findTextMatches({ text, query: '   ' })).toEqual([]);
    });

    it('finds case-insensitive line indices matching query', () => {
      expect(findTextMatches({ text, query: 'keyword' })).toEqual([1, 2]);
      expect(findTextMatches({ text, query: 'first' })).toEqual([0]);
      expect(findTextMatches({ text, query: 'line' })).toEqual([0, 1, 2, 3]);
    });

    it('returns empty array when query does not match', () => {
      expect(findTextMatches({ text, query: 'notfound' })).toEqual([]);
    });
  });

  describe('filterSheetRows', () => {
    const rows = [
      ['Alice', 'Engineer', 'São Paulo'],
      ['Bob', 'Designer', 'Rio de Janeiro'],
      ['Charlie', 'Manager', 'Belo Horizonte'],
    ];

    it('returns all rows with 1-based original index when query is empty', () => {
      const result = filterSheetRows({ rows, query: '' });
      expect(result).toEqual([
        { rowIndex: 1, cells: ['Alice', 'Engineer', 'São Paulo'] },
        { rowIndex: 2, cells: ['Bob', 'Designer', 'Rio de Janeiro'] },
        { rowIndex: 3, cells: ['Charlie', 'Manager', 'Belo Horizonte'] },
      ]);
    });

    it('filters rows matching query in any cell preserving original 1-based index', () => {
      const result = filterSheetRows({ rows, query: 'design' });
      expect(result).toEqual([{ rowIndex: 2, cells: ['Bob', 'Designer', 'Rio de Janeiro'] }]);
    });

    it('filters case-insensitively across different columns', () => {
      const result = filterSheetRows({ rows, query: 'paulo' });
      expect(result).toEqual([{ rowIndex: 1, cells: ['Alice', 'Engineer', 'São Paulo'] }]);
    });

    it('returns empty array when query matches nothing', () => {
      expect(filterSheetRows({ rows, query: 'xyz' })).toEqual([]);
    });
  });

  describe('formatFileSize', () => {
    it('formats bytes, kilobytes, and megabytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(512)).toBe('512 B');
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(2048)).toBe('2 KB');
      expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
      expect(formatFileSize(5 * 1024 * 1024 + 512 * 1024)).toBe('5.5 MB');
    });
  });

  describe('clampZoom', () => {
    it('clamps values below 0.25 to 0.25', () => {
      expect(clampZoom(0)).toBe(0.25);
      expect(clampZoom(0.1)).toBe(0.25);
      expect(clampZoom(0.25)).toBe(0.25);
    });

    it('preserves valid values between 0.25 and 4', () => {
      expect(clampZoom(0.5)).toBe(0.5);
      expect(clampZoom(1)).toBe(1);
      expect(clampZoom(2.5)).toBe(2.5);
      expect(clampZoom(4)).toBe(4);
    });

    it('clamps values above 4 to 4', () => {
      expect(clampZoom(4.1)).toBe(4);
      expect(clampZoom(10)).toBe(4);
    });
  });
});
