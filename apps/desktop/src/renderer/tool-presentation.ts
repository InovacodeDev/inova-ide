import type { SupportedLocale } from '@inova/core/types';
import type { ChatItem } from './chat-reducer';
import { translate } from './i18n';

type ToolItemInput = Pick<
  Extract<ChatItem, { type: 'tool' }>,
  'name' | 'input' | 'output' | 'isError'
>;

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface PresentedEditTool {
  kind: 'edit';
  operation: 'edit' | 'write';
  filePath: string;
  addedLines: number;
  removedLines: number;
  diffLines: DiffLine[];
}

export interface PresentedShellTool {
  kind: 'shell';
  command: string;
  description: string | null;
  output: string | null;
  lineCount: number;
}

export interface PresentedLookupTool {
  kind: 'lookup';
  category: 'read' | 'search' | 'files' | 'web';
  label: string;
  target: string;
  detail: string | null;
  output: string | null;
}

export interface TodoEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface PresentedTodoTool {
  kind: 'todo';
  items: TodoEntry[];
  completedCount: number;
}

export interface PresentedGenericTool {
  kind: 'generic';
  title: string;
  result: string | null;
  entries: { key: string; value: string }[];
  rawInput: string;
  output: string | null;
}

export type PresentedTool =
  | PresentedEditTool
  | PresentedShellTool
  | PresentedLookupTool
  | PresentedTodoTool
  | PresentedGenericTool;

const MAX_SUMMARY_CHARS = 100;
const MAX_LCS_CELLS = 160_000;
const SUMMARY_KEYS = [
  'description',
  'command',
  'file_path',
  'filePath',
  'path',
  'pattern',
  'query',
  'url',
  'prompt',
] as const;

const EDIT_TOOLS = new Set([
  'edit',
  'multiedit',
  'edit_file',
  'replace_file_content',
  'multi_replace_file_content',
]);
const WRITE_TOOLS = new Set(['write', 'write_file', 'write_to_file']);
const SHELL_TOOLS = new Set([
  'bash',
  'run_command',
  'command_execution',
  'shell',
  'execute_command',
]);
const READ_TOOLS = new Set(['read', 'read_file']);
const SEARCH_TOOLS = new Set(['grep', 'grep_search']);
const FILES_TOOLS = new Set(['glob', 'find_by_name', 'ls', 'list_dir']);
const WEB_TOOLS = new Set(['websearch', 'webfetch', 'search_web', 'read_url_content']);

export function plural(input: { count: number; one: string; many: string }): string {
  return `${input.count} ${input.count === 1 ? input.one : input.many}`;
}

export function firstLine(input: string): string {
  const line = input.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  const trimmed = line.trim();
  return trimmed.length > MAX_SUMMARY_CHARS ? `${trimmed.slice(0, MAX_SUMMARY_CHARS)}…` : trimmed;
}

export function parseInputRecord(input: string): Record<string, unknown> | null {
  if (!input.trimStart().startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(input);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function toolSummary(
  item: Pick<ToolItemInput, 'input' | 'output' | 'isError'>,
  locale: SupportedLocale = 'pt-BR',
): {
  title: string;
  result: string | null;
} {
  const record = parseInputRecord(item.input);
  const described = SUMMARY_KEYS.flatMap((key) => {
    const value = record?.[key];
    return typeof value === 'string' && value.trim() !== '' ? [value] : [];
  })[0];
  const title = firstLine(described ?? item.input);
  if (item.output === null || item.isError) return { title, result: null };
  const output = item.output.trim();
  const lineCount = output.split('\n').length;
  const result =
    output === ''
      ? translate(locale, 'tool.noOutput')
      : translate(locale, lineCount === 1 ? 'tool.lineSingular' : 'tool.linePlural', {
          count: lineCount,
        });
  return { title, result };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickStr(record: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

function pickNonEmptyStr(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function pickNum(record: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

function countOutputLines(output: string | null): number {
  if (output === null) return 0;
  const trimmed = output.trimEnd();
  return trimmed === '' ? 0 : trimmed.split('\n').length;
}

function computeLineDiff(input: {
  oldText: string;
  newText: string;
  startLine?: number;
}): DiffLine[] {
  const oldLines = splitLines(input.oldText);
  const newLines = splitLines(input.newText);
  const baseLine = input.startLine ?? 1;

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > prefix && newEnd > prefix && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const lines: DiffLine[] = [];
  for (let i = 0; i < prefix; i += 1) {
    lines.push({
      type: 'ctx',
      oldLine: baseLine + i,
      newLine: baseLine + i,
      text: oldLines[i] ?? '',
    });
  }

  const midOld = oldLines.slice(prefix, oldEnd);
  const midNew = newLines.slice(prefix, newEnd);
  const m = midOld.length;
  const n = midNew.length;

  if (m === 0 || n === 0 || m * n > MAX_LCS_CELLS) {
    for (let i = 0; i < m; i += 1) {
      lines.push({
        type: 'del',
        oldLine: baseLine + prefix + i,
        newLine: null,
        text: midOld[i] ?? '',
      });
    }
    for (let j = 0; j < n; j += 1) {
      lines.push({
        type: 'add',
        oldLine: null,
        newLine: baseLine + prefix + j,
        text: midNew[j] ?? '',
      });
    }
  } else {
    const cols = n + 1;
    const dp = new Int32Array((m + 1) * cols);
    for (let i = m - 1; i >= 0; i -= 1) {
      const oldLine = midOld[i];
      for (let j = n - 1; j >= 0; j -= 1) {
        dp[i * cols + j] =
          oldLine === midNew[j]
            ? (dp[(i + 1) * cols + (j + 1)] ?? 0) + 1
            : Math.max(dp[(i + 1) * cols + j] ?? 0, dp[i * cols + (j + 1)] ?? 0);
      }
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (midOld[i] === midNew[j]) {
        lines.push({
          type: 'ctx',
          oldLine: baseLine + prefix + i,
          newLine: baseLine + prefix + j,
          text: midOld[i] ?? '',
        });
        i += 1;
        j += 1;
      } else if ((dp[(i + 1) * cols + j] ?? 0) >= (dp[i * cols + (j + 1)] ?? 0)) {
        lines.push({
          type: 'del',
          oldLine: baseLine + prefix + i,
          newLine: null,
          text: midOld[i] ?? '',
        });
        i += 1;
      } else {
        lines.push({
          type: 'add',
          oldLine: null,
          newLine: baseLine + prefix + j,
          text: midNew[j] ?? '',
        });
        j += 1;
      }
    }
    while (i < m) {
      lines.push({
        type: 'del',
        oldLine: baseLine + prefix + i,
        newLine: null,
        text: midOld[i] ?? '',
      });
      i += 1;
    }
    while (j < n) {
      lines.push({
        type: 'add',
        oldLine: null,
        newLine: baseLine + prefix + j,
        text: midNew[j] ?? '',
      });
      j += 1;
    }
  }

  for (let k = 0; k < oldLines.length - oldEnd; k += 1) {
    lines.push({
      type: 'ctx',
      oldLine: baseLine + oldEnd + k,
      newLine: baseLine + newEnd + k,
      text: oldLines[oldEnd + k] ?? '',
    });
  }

  return lines;
}

interface RawEditHunk {
  oldText: string;
  newText: string;
  startLine?: number;
}

function extractEditHunks(record: Record<string, unknown>): RawEditHunk[] {
  const list = Array.isArray(record['edits'])
    ? record['edits']
    : Array.isArray(record['ReplacementChunks'])
      ? record['ReplacementChunks']
      : null;

  if (list !== null) {
    const hunks: RawEditHunk[] = [];
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const oldText = pickStr(entry, ['old_string', 'oldString', 'Target', 'TargetContent']);
      const newText = pickStr(entry, [
        'new_string',
        'newString',
        'Replacement',
        'ReplacementContent',
      ]);
      if (oldText !== null && newText !== null) {
        const start = pickNum(entry, ['StartLine']) ?? undefined;
        hunks.push({ oldText, newText, ...(start === undefined ? {} : { startLine: start }) });
      }
    }
    return hunks;
  }

  const oldText = pickStr(record, ['old_string', 'oldString', 'Target', 'TargetContent']);
  const newText = pickStr(record, ['new_string', 'newString', 'Replacement', 'ReplacementContent']);
  if (oldText !== null && newText !== null) {
    const start = pickNum(record, ['StartLine']) ?? undefined;
    return [{ oldText, newText, ...(start === undefined ? {} : { startLine: start }) }];
  }
  return [];
}

function presentEditTool(
  normalizedName: string,
  record: Record<string, unknown> | null,
): PresentedEditTool | null {
  const filePath = pickNonEmptyStr(record, ['file_path', 'filePath', 'path', 'Path', 'TargetFile']);
  if (!record || filePath === null) return null;

  const hunks = extractEditHunks(record);
  const content = pickStr(record, ['content', 'Content', 'CodeContent']);
  const isWrite = (WRITE_TOOLS.has(normalizedName) || hunks.length === 0) && content !== null;

  if (isWrite) {
    const diffLines: DiffLine[] = splitLines(content).map((text, index) => ({
      type: 'add',
      oldLine: null,
      newLine: index + 1,
      text,
    }));
    return {
      kind: 'edit',
      operation: 'write',
      filePath,
      addedLines: diffLines.length,
      removedLines: 0,
      diffLines,
    };
  }

  const diffLines = hunks.flatMap((hunk) => computeLineDiff(hunk));
  const addedLines = diffLines.filter((line) => line.type === 'add').length;
  const removedLines = diffLines.filter((line) => line.type === 'del').length;

  return {
    kind: 'edit',
    operation: 'edit',
    filePath,
    addedLines,
    removedLines,
    diffLines,
  };
}

function formatReadTarget(record: Record<string, unknown> | null, rawInput: string): string {
  const filePath = pickNonEmptyStr(record, [
    'file_path',
    'filePath',
    'path',
    'Path',
    'AbsolutePath',
  ]);
  if (filePath === null) return firstLine(rawInput);
  const start = pickNum(record, ['StartLine', 'offset']);
  const endLine = pickNum(record, ['EndLine']);
  const limit = pickNum(record, ['limit']);
  if (start !== null && endLine !== null) return `${filePath}:${start}-${endLine}`;
  if (start !== null && limit !== null) return `${filePath}:${start}-${start + limit - 1}`;
  if (start !== null) return `${filePath}:${start}`;
  return filePath;
}

function presentLookupTool(
  normalizedName: string,
  record: Record<string, unknown> | null,
  item: ToolItemInput,
  locale: SupportedLocale,
): PresentedLookupTool {
  const hasOutput = item.output !== null && !item.isError;
  const lines = countOutputLines(item.output);

  if (READ_TOOLS.has(normalizedName)) {
    return {
      kind: 'lookup',
      category: 'read',
      label: translate(locale, 'tool.lookup.read'),
      target: formatReadTarget(record, item.input),
      detail: hasOutput
        ? lines === 0
          ? translate(locale, 'tool.lookup.emptyFile')
          : translate(locale, lines === 1 ? 'tool.lineSingular' : 'tool.linePlural', {
              count: lines,
            })
        : null,
      output: item.output,
    };
  }

  if (SEARCH_TOOLS.has(normalizedName)) {
    const pattern = pickNonEmptyStr(record, ['pattern', 'Pattern', 'Query', 'query']);
    const scope = pickNonEmptyStr(record, ['path', 'SearchPath', 'SearchDirectory']);
    const target = pattern
      ? scope
        ? translate(locale, 'tool.lookup.searchIn', { pattern, scope })
        : pattern
      : firstLine(item.input);
    return {
      kind: 'lookup',
      category: 'search',
      label: translate(locale, 'tool.lookup.search'),
      target,
      detail: hasOutput
        ? lines === 0
          ? translate(locale, 'tool.lookup.noResults')
          : translate(
              locale,
              lines === 1 ? 'tool.lookup.matchSingular' : 'tool.lookup.matchPlural',
              { count: lines },
            )
        : null,
      output: item.output,
    };
  }

  if (FILES_TOOLS.has(normalizedName)) {
    const target =
      pickNonEmptyStr(record, [
        'pattern',
        'Pattern',
        'path',
        'Path',
        'SearchDirectory',
        'DirectoryPath',
      ]) ?? '.';
    return {
      kind: 'lookup',
      category: 'files',
      label: translate(locale, 'tool.lookup.files'),
      target,
      detail: hasOutput
        ? lines === 0
          ? translate(locale, 'tool.lookup.empty')
          : translate(locale, lines === 1 ? 'tool.itemSingular' : 'tool.itemPlural', {
              count: lines,
            })
        : null,
      output: item.output,
    };
  }

  return {
    kind: 'lookup',
    category: 'web',
    label: translate(locale, 'tool.lookup.web'),
    target: pickNonEmptyStr(record, ['query', 'url', 'Url']) ?? firstLine(item.input),
    detail: hasOutput
      ? lines === 0
        ? translate(locale, 'tool.noOutput')
        : translate(locale, lines === 1 ? 'tool.lineSingular' : 'tool.linePlural', {
            count: lines,
          })
      : null,
    output: item.output,
  };
}

function normalizeTodoStatus(value: unknown): TodoEntry['status'] {
  if (value === 'completed' || value === 'in_progress') return value;
  return 'pending';
}

function presentTodoTool(record: Record<string, unknown> | null): PresentedTodoTool | null {
  if (!record || !Array.isArray(record['todos'])) return null;
  const items: TodoEntry[] = [];
  for (const raw of record['todos']) {
    if (!isRecord(raw)) continue;
    const content = pickNonEmptyStr(raw, ['content', 'title', 'text']);
    if (content === null) continue;
    items.push({ content, status: normalizeTodoStatus(raw['status']) });
  }
  return {
    kind: 'todo',
    items,
    completedCount: items.filter((entry) => entry.status === 'completed').length,
  };
}

function formatEntryValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return JSON.stringify(value, null, 2) ?? '';
}

export function presentTool(item: ToolItemInput, locale: SupportedLocale = 'pt-BR'): PresentedTool {
  const normalizedName = item.name.trim().toLowerCase();
  const record = parseInputRecord(item.input);

  if (EDIT_TOOLS.has(normalizedName) || WRITE_TOOLS.has(normalizedName)) {
    const edit = presentEditTool(normalizedName, record);
    if (edit) return edit;
  }

  if (SHELL_TOOLS.has(normalizedName)) {
    const command = pickNonEmptyStr(record, ['command', 'CommandLine', 'cmd']) ?? item.input.trim();
    const rawDescription = pickNonEmptyStr(record, ['description', 'toolSummary']);
    const description =
      rawDescription !== null && rawDescription !== command ? rawDescription : null;
    return {
      kind: 'shell',
      command,
      description,
      output: item.output,
      lineCount: countOutputLines(item.output),
    };
  }

  if (
    READ_TOOLS.has(normalizedName) ||
    SEARCH_TOOLS.has(normalizedName) ||
    FILES_TOOLS.has(normalizedName) ||
    WEB_TOOLS.has(normalizedName)
  ) {
    return presentLookupTool(normalizedName, record, item, locale);
  }

  if (normalizedName === 'todowrite') {
    const todo = presentTodoTool(record);
    if (todo) return todo;
  }

  const summary = toolSummary(item, locale);
  const entries = record
    ? Object.entries(record).map(([key, value]) => ({ key, value: formatEntryValue(value) }))
    : [];

  return {
    kind: 'generic',
    title: summary.title,
    result: summary.result,
    entries,
    rawInput: item.input,
    output: item.output,
  };
}
