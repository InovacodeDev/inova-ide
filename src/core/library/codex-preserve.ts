import { CapabilityFileError, listTomlTables } from '../capabilities/file-edit.js';

type SectionPath = readonly string[] | null;

// REGEX: leading TOML key (double-quoted or bare) followed by "=" or a dotted continuation
const LEADING_KEY = /^\s*("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)\s*([.=])/;
// REGEX: root-level "mcp_servers = ..." or "mcp_servers.<key>..." assignment
const ROOT_MCP_KEY = /^\s*mcp_servers\s*(=|\.\s*("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)\s*[.=])/;

function headerPath(line: string): SectionPath | undefined {
  if (!line.trimStart().startsWith('[')) return undefined;
  return listTomlTables(line)[0] ?? null;
}

function serverOf(path: SectionPath): string | null {
  return path && path.length >= 2 && path[0] === 'mcp_servers' ? (path[1] ?? null) : null;
}

function isTrivia(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

function keyName(raw: string): string {
  if (!raw.startsWith('"')) return raw;
  try {
    return String(JSON.parse(raw));
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new CapabilityFileError('config.toml', 'unsupported string escape');
    }
    throw error;
  }
}

function definesInline(input: {
  line: string;
  section: SectionPath | undefined;
  names: ReadonlySet<string>;
}): boolean {
  const { line, section, names } = input;
  if (names.size === 0) return false;
  if (section === undefined) {
    const match = ROOT_MCP_KEY.exec(line);
    if (!match) return false;
    return match[1] === '=' || names.has(keyName(match[2] ?? ''));
  }
  if (section?.length !== 1 || section[0] !== 'mcp_servers') return false;
  const match = LEADING_KEY.exec(line);
  return match !== null && names.has(keyName(match[1] ?? ''));
}

function flushTrivia(kept: string[], pending: readonly string[]): void {
  let start = 0;
  if (kept.at(-1)?.trim() === '') {
    while (start < pending.length && pending[start]?.trim() === '') start += 1;
  }
  kept.push(...pending.slice(start));
}

// REGEX: single-bracket header of the mcp_servers table or of one of its subtables
const MCP_HEADER_LINE = /^\s*\[\s*(?:mcp_servers|"mcp_servers")\s*[.\]]/;

export function codexMcpTablesText(toml: string): string {
  const kept: string[] = [];
  let inside = false;
  for (const line of toml.split('\n')) {
    if (line.trimStart().startsWith('[')) inside = MCP_HEADER_LINE.test(line);
    if (inside) kept.push(line);
  }
  return kept.join('\n').trimEnd();
}

export function stripCodexServerTables(input: {
  toml: string;
  names: ReadonlySet<string>;
}): string {
  const { toml, names } = input;
  const kept: string[] = [];
  let pending: string[] = [];
  let section: SectionPath | undefined;
  let stripping = false;
  for (const line of toml.split('\n')) {
    const path = headerPath(line);
    if (path !== undefined) {
      const server = serverOf(path);
      const strip = server !== null && names.has(server);
      if (stripping && !strip) flushTrivia(kept, pending);
      pending = [];
      section = path;
      stripping = strip;
      if (!strip) kept.push(line);
      continue;
    }
    if (definesInline({ line, section, names })) {
      throw new CapabilityFileError('config.toml', 'mcp server defined inline; cannot edit safely');
    }
    if (!stripping) kept.push(line);
    else if (isTrivia(line)) pending.push(line);
    else pending = [];
  }
  return kept.join('\n').trimEnd();
}
