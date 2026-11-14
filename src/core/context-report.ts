import type { ContextBreakdown, ContextCategory, ContextSection } from './chat-types.js';

const CATEGORY_HEADING = 'Estimated usage by category';
const TOKEN_UNITS: Record<string, number> = { '': 1, k: 1_000, m: 1_000_000 };
// REGEX: optional "~", number with optional thousands commas/decimals, optional k/m suffix
const TOKEN_PATTERN = /^~?\s*([\d,]+(?:\.\d+)?)\s*([km]?)$/i;
// REGEX: "**Tokens:** 29.5k / 1m (3%)" captures used and window counts
const TOTALS_PATTERN = /^\*\*Tokens:\*\*\s*([^/]+?)\s*\/\s*([^\s(]+)/;
// REGEX: "**Model:** claude-opus-5-5" captures the model id
const MODEL_PATTERN = /^\*\*Model:\*\*\s*(\S+)/;

export function claudeContextArgs(providerSessionId: string): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--resume',
    providerSessionId,
    '--fork-session',
    '--no-session-persistence',
    '--',
    '/context',
  ];
}

export function parseTokenCount(raw: string): number | null {
  const match = TOKEN_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, digits = '', unit = ''] = match;
  const multiplier = TOKEN_UNITS[unit.toLowerCase()] ?? 1;
  return Math.round(Number(digits.replaceAll(',', '')) * multiplier);
}

function parsePercent(raw: string): number | null {
  const value = Number.parseFloat(raw.replace('%', ''));
  return Number.isFinite(value) ? value : null;
}

function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

interface RawTable {
  title: string;
  columns: string[];
  rows: string[][];
}

function collectTables(lines: readonly string[]): RawTable[] {
  const tables: RawTable[] = [];
  let title = '';
  let current: RawTable | null = null;
  for (const line of lines) {
    if (line.startsWith('#')) {
      title = line.replace(/^#+\s*/, '').trim();
      current = null;
      continue;
    }
    const cells = tableCells(line);
    if (cells === null) {
      current = null;
      continue;
    }
    if (current === null) {
      current = { title, columns: cells, rows: [] };
      tables.push(current);
    } else if (!isSeparatorRow(cells)) {
      current.rows.push(cells);
    }
  }
  return tables;
}

function toCategories(table: RawTable): ContextCategory[] {
  return table.rows.flatMap(([name = '', tokens = '', percent = '']) => {
    const count = parseTokenCount(tokens);
    return name === '' || count === null
      ? []
      : [{ name, tokens: count, percent: parsePercent(percent) }];
  });
}

function toSection(table: RawTable): ContextSection {
  return {
    title: table.title,
    columns: table.columns,
    rows: table.rows.map((cells) => ({ cells, tokens: parseTokenCount(cells.at(-1) ?? '') })),
  };
}

export function parseContextReport(markdown: string): ContextBreakdown | null {
  const lines = markdown.split('\n').map((line) => line.trimEnd());
  const tables = collectTables(lines);
  const categoryTable = tables.find((table) => table.title === CATEGORY_HEADING);
  if (categoryTable === undefined) return null;
  const totals = lines.map((line) => TOTALS_PATTERN.exec(line)).find((match) => match !== null);
  const model = lines.map((line) => MODEL_PATTERN.exec(line)).find((match) => match !== null);
  return {
    model: model?.[1] ?? null,
    usedTokens: totals?.[1] === undefined ? null : parseTokenCount(totals[1]),
    windowTokens: totals?.[2] === undefined ? null : parseTokenCount(totals[2]),
    categories: toCategories(categoryTable),
    sections: tables.filter((table) => table !== categoryTable).map(toSection),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseClaudeContextOutput(stdout: string): ContextBreakdown | null {
  let body: unknown;
  try {
    body = JSON.parse(stdout);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!isRecord(body) || body['is_error'] === true || typeof body['result'] !== 'string') {
    return null;
  }
  return parseContextReport(body['result']);
}
