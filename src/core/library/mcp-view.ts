import { CapabilityFileError, listTomlTables } from '../capabilities/file-edit.js';

// REGEX: value of a query parameter, up to the next "&", "#" or quote
const QUERY_VALUE = /([?&][^=&#"']*=)[^&#"']*/g;
// REGEX: "user:password@" right after the "://" of a URL
const USER_INFO = /(:\/\/)[^/@\s"']+@/g;

export function maskUrlSecrets(text: string): string {
  return text.replace(USER_INFO, '$1***@').replace(QUERY_VALUE, '$1***');
}

const SAFE_SERVER_KEYS: ReadonlySet<string> = new Set([
  'command',
  'url',
  'type',
  'enabled',
  'startup_timeout_sec',
  'tool_timeout_sec',
  'args',
]);

// REGEX: "<key> = <value>" with a bare, double-quoted or single-quoted key, optionally dotted
const ASSIGNMENT =
  /^(\s*)((?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)(?:\s*\.\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+))*)\s*=\s*(.*)$/;
// REGEX: whole value is one literal: basic or literal string, boolean, number or one-line array
const SINGLE_LINE_LITERAL =
  /^(?:"(?:[^"\\]|\\.)*"|'[^']*'|true|false|[+-]?\d[\d_]*(?:\.\d+)?|\[.*\])$/;
// REGEX: comment after the closing bracket of a table header
const HEADER_COMMENT = /\]\s*#.*$/;

interface ViewState {
  serverTable: boolean;
  inMultiline: boolean;
}

function isServerTable(line: string): boolean {
  try {
    const path = listTomlTables(line)[0];
    return path !== undefined && path.length === 2 && path[0] === 'mcp_servers';
  } catch (error: unknown) {
    if (error instanceof CapabilityFileError) return false;
    throw error;
  }
}

function togglesMultiline(line: string): boolean {
  const delimiters = line.match(/"""|'''/g) ?? [];
  return delimiters.length % 2 === 1;
}

function maskAssignment(input: { match: RegExpExecArray; serverTable: boolean }): string {
  const [line, indent = '', key = '', value = ''] = input.match;
  const safe =
    input.serverTable && SAFE_SERVER_KEYS.has(key) && SINGLE_LINE_LITERAL.test(value.trim());
  if (!safe) return `${indent}${key} = "***"`;
  return key === 'url' ? maskUrlSecrets(line) : line;
}

function maskLine(line: string, state: ViewState): string | null {
  if (state.inMultiline) {
    if (togglesMultiline(line)) state.inMultiline = false;
    return null;
  }
  if (line.trimStart().startsWith('[')) {
    state.serverTable = isServerTable(line);
    return line.replace(HEADER_COMMENT, ']');
  }
  if (line.trim() === '') return line;
  if (togglesMultiline(line)) state.inMultiline = true;
  const match = ASSIGNMENT.exec(line);
  return match ? maskAssignment({ match, serverTable: state.serverTable }) : null;
}

export function maskCodexMcpView(text: string): string {
  const state: ViewState = { serverTable: false, inMultiline: false };
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const masked = maskLine(line.replace(/\r$/, ''), state);
    if (masked !== null) kept.push(masked);
  }
  return kept.join('\n');
}
