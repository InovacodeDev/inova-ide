import { describe, expect, test } from 'vitest';
import {
  claudeContextArgs,
  parseClaudeContextOutput,
  parseContextReport,
  parseTokenCount,
} from './context-report.js';

const REPORT = `## Context Usage

**Model:** claude-opus-5-5
**Tokens:** 29.5k / 1m (3%)

### Estimated usage by category

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 2.5k | 0.2% |
| MCP tools | 612 | 0.1% |
| Messages | 9.6k | 1.0% |
| Free space | 943.7k | 94.4% |

### MCP Tools

| Tool | Server | Tokens |
|------|--------|--------|
| mcp__docs__read | docs | 1.1k |
| mcp__docs__write | docs | 431 |

### Memory Files

| Type | Path | Tokens |
|------|------|--------|
| Project | /repo/CLAUDE.md | 6.1k |

### Skills

| Skill | Source | Tokens |
|-------|--------|--------|
| loop | Built-in | ~120 |
`;

describe('parseTokenCount', () => {
  test.each([
    ['612', 612],
    ['2.5k', 2500],
    ['~80', 80],
    ['1m', 1_000_000],
    ['943.7k', 943_700],
    ['1,234', 1234],
  ])('parses %s', (raw, expected) => {
    expect(parseTokenCount(raw)).toBe(expected);
  });

  test('returns null for text', () => {
    expect(parseTokenCount('n/a')).toBeNull();
  });
});

describe('parseContextReport', () => {
  test('reads model, totals, categories and detail sections', () => {
    expect(parseContextReport(REPORT)).toEqual({
      model: 'claude-opus-5-5',
      usedTokens: 29_500,
      windowTokens: 1_000_000,
      categories: [
        { name: 'System prompt', tokens: 2500, percent: 0.2 },
        { name: 'MCP tools', tokens: 612, percent: 0.1 },
        { name: 'Messages', tokens: 9600, percent: 1 },
        { name: 'Free space', tokens: 943_700, percent: 94.4 },
      ],
      sections: [
        {
          title: 'MCP Tools',
          columns: ['Tool', 'Server', 'Tokens'],
          rows: [
            { cells: ['mcp__docs__read', 'docs', '1.1k'], tokens: 1100 },
            { cells: ['mcp__docs__write', 'docs', '431'], tokens: 431 },
          ],
        },
        {
          title: 'Memory Files',
          columns: ['Type', 'Path', 'Tokens'],
          rows: [{ cells: ['Project', '/repo/CLAUDE.md', '6.1k'], tokens: 6100 }],
        },
        {
          title: 'Skills',
          columns: ['Skill', 'Source', 'Tokens'],
          rows: [{ cells: ['loop', 'Built-in', '~120'], tokens: 120 }],
        },
      ],
    });
  });

  test('returns null when the text has no category table', () => {
    expect(parseContextReport('Unknown command: /context')).toBeNull();
  });
});

describe('parseClaudeContextOutput', () => {
  test('reads the report from the json result', () => {
    const stdout = JSON.stringify({ is_error: false, result: REPORT });
    expect(parseClaudeContextOutput(stdout)?.usedTokens).toBe(29_500);
  });

  test('returns null for an error result or invalid json', () => {
    expect(parseClaudeContextOutput(JSON.stringify({ is_error: true, result: REPORT }))).toBeNull();
    expect(parseClaudeContextOutput('not json')).toBeNull();
  });
});

test('context args never persist the forked session', () => {
  expect(claudeContextArgs('abc')).toEqual([
    '-p',
    '--output-format',
    'json',
    '--resume',
    'abc',
    '--fork-session',
    '--no-session-persistence',
    '--',
    '/context',
  ]);
});
