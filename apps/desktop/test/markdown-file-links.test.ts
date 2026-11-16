import { describe, expect, test } from 'vitest';
import { parseInlineFileCode, parseLocalFileHref } from '../src/renderer/markdown-file-links';

describe('parseLocalFileHref', () => {
  test('returns path and line for file:// URLs with hash anchor', () => {
    expect(parseLocalFileHref('file:///repo/src/app.ts#L12')).toEqual({
      path: '/repo/src/app.ts',
      line: 12,
    });
    expect(parseLocalFileHref('file:///repo/src/app.ts#12')).toEqual({
      path: '/repo/src/app.ts',
      line: 12,
    });
    expect(parseLocalFileHref('file:///repo/src/app.ts#L12-L24')).toEqual({
      path: '/repo/src/app.ts',
      line: 12,
    });
  });

  test('returns path and null line for relative file paths', () => {
    expect(parseLocalFileHref('car_comparison.html')).toEqual({
      path: 'car_comparison.html',
      line: null,
    });
    expect(parseLocalFileHref('./components/Button.tsx')).toEqual({
      path: './components/Button.tsx',
      line: null,
    });
    expect(parseLocalFileHref('../shared/api.ts')).toEqual({
      path: '../shared/api.ts',
      line: null,
    });
  });

  test('parses line suffix in path when present', () => {
    expect(parseLocalFileHref('src/app.ts:42')).toEqual({
      path: 'src/app.ts',
      line: 42,
    });
    expect(parseLocalFileHref('src/app.ts:42:10')).toEqual({
      path: 'src/app.ts',
      line: 42,
    });
  });

  test('decodes URI components in file paths', () => {
    expect(parseLocalFileHref('file:///repo/my%20documents/file.md#L5')).toEqual({
      path: '/repo/my documents/file.md',
      line: 5,
    });
  });

  test('returns null for external URLs, anchors, and non-file schemes', () => {
    expect(parseLocalFileHref('https://example.com')).toBeNull();
    expect(parseLocalFileHref('http://localhost:3000')).toBeNull();
    expect(parseLocalFileHref('mailto:a@b.com')).toBeNull();
    expect(parseLocalFileHref('#heading')).toBeNull();
    expect(parseLocalFileHref('#')).toBeNull();
    expect(parseLocalFileHref('')).toBeNull();
    expect(parseLocalFileHref('   ')).toBeNull();
    expect(parseLocalFileHref('javascript:void(0)')).toBeNull();
    expect(parseLocalFileHref('//example.com/asset.js')).toBeNull();
  });
});

describe('parseInlineFileCode', () => {
  test('returns path and line for paths with line number suffix', () => {
    expect(parseInlineFileCode('src/core/files.ts:42')).toEqual({
      path: 'src/core/files.ts',
      line: 42,
    });
    expect(parseInlineFileCode('src/core/files.ts:42:15')).toEqual({
      path: 'src/core/files.ts',
      line: 42,
    });
    expect(parseInlineFileCode('src/core/files.ts#L42')).toEqual({
      path: 'src/core/files.ts',
      line: 42,
    });
  });

  test('returns path and null line for files with known extensions', () => {
    expect(parseInlineFileCode('report.xlsx')).toEqual({
      path: 'report.xlsx',
      line: null,
    });
    expect(parseInlineFileCode('data.csv')).toEqual({
      path: 'data.csv',
      line: null,
    });
    expect(parseInlineFileCode('index.html')).toEqual({
      path: 'index.html',
      line: null,
    });
    expect(parseInlineFileCode('package.json')).toEqual({
      path: 'package.json',
      line: null,
    });
  });

  test('returns path for files with directory separators', () => {
    expect(parseInlineFileCode('./scripts/build.sh')).toEqual({
      path: './scripts/build.sh',
      line: null,
    });
    expect(parseInlineFileCode('../shared/api.ts')).toEqual({
      path: '../shared/api.ts',
      line: null,
    });
  });

  test('recognizes standard standalone configuration files', () => {
    expect(parseInlineFileCode('Dockerfile')).toEqual({
      path: 'Dockerfile',
      line: null,
    });
    expect(parseInlineFileCode('.gitignore')).toEqual({
      path: '.gitignore',
      line: null,
    });
  });

  test('returns null for plain words, commands, and version strings', () => {
    expect(parseInlineFileCode('npm test')).toBeNull();
    expect(parseInlineFileCode('useState')).toBeNull();
    expect(parseInlineFileCode('v0.9.2')).toBeNull();
    expect(parseInlineFileCode('git commit -m "fix"')).toBeNull();
    expect(parseInlineFileCode('pnpm run build')).toBeNull();
    expect(parseInlineFileCode('const result = 1')).toBeNull();
    expect(parseInlineFileCode('1.0.0')).toBeNull();
    expect(parseInlineFileCode('v1.0')).toBeNull();
    expect(parseInlineFileCode('')).toBeNull();
    expect(parseInlineFileCode('   ')).toBeNull();
  });

  test('returns null for mathematical expressions or code calls', () => {
    expect(parseInlineFileCode('1/2')).toBeNull();
    expect(parseInlineFileCode('calculate(a/b)')).toBeNull();
    expect(parseInlineFileCode('<div>')).toBeNull();
    expect(parseInlineFileCode('https://example.com/repo')).toBeNull();
  });
});
