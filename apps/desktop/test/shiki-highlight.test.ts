import { describe, expect, test } from 'vitest';
import { canonicalLang, highlightCode, languageForFilePath } from '../src/renderer/shiki-highlight';

describe('canonicalLang', () => {
  test('maps common aliases to canonical language names', () => {
    expect(canonicalLang('ts')).toBe('typescript');
    expect(canonicalLang('py')).toBe('python');
    expect(canonicalLang('yml')).toBe('yaml');
    expect(canonicalLang('htm')).toBe('html');
    expect(canonicalLang('md')).toBe('markdown');
  });

  test('normalizes case-insensitively', () => {
    expect(canonicalLang('TS')).toBe('typescript');
    expect(canonicalLang('PyThOn')).toBe('python');
    expect(canonicalLang('YAML')).toBe('yaml');
  });

  test('returns direct canonical name when already canonical', () => {
    expect(canonicalLang('typescript')).toBe('typescript');
    expect(canonicalLang('tsx')).toBe('tsx');
    expect(canonicalLang('javascript')).toBe('javascript');
    expect(canonicalLang('rust')).toBe('rust');
    expect(canonicalLang('csv')).toBe('csv');
  });

  test('returns null for unknown languages', () => {
    expect(canonicalLang('unknown')).toBeNull();
    expect(canonicalLang('xyz')).toBeNull();
    expect(canonicalLang('')).toBeNull();
  });
});

describe('languageForFilePath', () => {
  test('resolves language for common file extensions and special filenames', () => {
    expect(languageForFilePath('foo.tsx')).toBe('tsx');
    expect(languageForFilePath('Dockerfile')).toBe('dockerfile');
    expect(languageForFilePath('report.csv')).toBe('csv');
    expect(languageForFilePath('unknown.xyz')).toBe('text');
  });

  test('resolves file paths with directories and case variations', () => {
    expect(languageForFilePath('/path/to/src/components/Button.TSX')).toBe('tsx');
    expect(languageForFilePath('C:\\project\\dockerfile')).toBe('dockerfile');
    expect(languageForFilePath('data/metrics.tsv')).toBe('tsv');
    expect(languageForFilePath('src/index.ts')).toBe('typescript');
    expect(languageForFilePath('app.py')).toBe('python');
    expect(languageForFilePath('Cargo.toml')).toBe('toml');
    expect(languageForFilePath('schema.graphql')).toBe('graphql');
    expect(languageForFilePath('README.md')).toBe('markdown');
    expect(languageForFilePath('styles.css')).toBe('css');
    expect(languageForFilePath('index.html')).toBe('html');
  });

  test('falls back to text for extensionless non-standard files', () => {
    expect(languageForFilePath('LICENSE')).toBe('text');
    expect(languageForFilePath('')).toBe('text');
  });
});

describe('highlightCode', () => {
  test('highlights supported code snippet into HTML', async () => {
    const html = await highlightCode({ code: 'const x: number = 42;', lang: 'typescript' });
    expect(html).not.toBeNull();
    expect(html).toContain('catppuccin-mocha');
    expect(html).toContain('42');
  });

  test('highlights code using alias', async () => {
    const html = await highlightCode({ code: 'def hello(): pass', lang: 'py' });
    expect(html).not.toBeNull();
    expect(html).toContain('hello');
  });

  test('returns null for unsupported language', async () => {
    const html = await highlightCode({ code: 'plain text', lang: 'unknown-lang' });
    expect(html).toBeNull();
  });

  test('serves cached results on repeated highlight calls', async () => {
    const first = await highlightCode({ code: 'let a = 1;', lang: 'js' });
    const second = await highlightCode({ code: 'let a = 1;', lang: 'js' });
    expect(first).not.toBeNull();
    expect(first).toBe(second);
  });
});
