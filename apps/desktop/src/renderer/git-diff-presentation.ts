export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitDiffLine {
  type: 'hunk' | 'add' | 'del' | 'ctx';
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface ParsedFileDiff {
  path: string;
  oldPath: string | null;
  status: GitFileStatus;
  binary: boolean;
  addedLines: number;
  removedLines: number;
  lines: GitDiffLine[];
}

export interface GitChangesSummary {
  fileCount: number;
  addedLines: number;
  removedLines: number;
}

export const STATUS_BADGE: Record<GitFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

export const STATUS_TITLE: Record<GitFileStatus, string> = {
  added: 'Adicionado',
  modified: 'Modificado',
  deleted: 'Removido',
  renamed: 'Renomeado',
};

const HUNK_PATTERN = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function unquoteGitPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\t/g, '\t')
      .replace(/\\n/g, '\n');
  }
  return trimmed;
}

function stripDiffPrefix(raw: string, prefix: 'a/' | 'b/'): string {
  const unquoted = unquoteGitPath(raw);
  return unquoted.startsWith(prefix) ? unquoted.slice(prefix.length) : unquoted;
}

function parseDiffGitHeader(line: string): { oldHeader: string; newHeader: string } {
  const rest = line.slice('diff --git '.length);
  const quotedMatch = /^"a\/([^"]+)" "b\/([^"]+)"$/.exec(rest);
  if (quotedMatch) {
    return {
      oldHeader: unquoteGitPath(`"${quotedMatch[1] ?? ''}"`),
      newHeader: unquoteGitPath(`"${quotedMatch[2] ?? ''}"`),
    };
  }
  const plainMatch = /^a\/(.+) b\/(.+)$/.exec(rest);
  if (plainMatch) {
    return {
      oldHeader: plainMatch[1] ?? rest,
      newHeader: plainMatch[2] ?? rest,
    };
  }
  return { oldHeader: rest, newHeader: rest };
}

function parseDiffSection(sectionLines: readonly string[]): ParsedFileDiff | null {
  const first = sectionLines[0];
  if (!first || !first.startsWith('diff --git ')) return null;

  const { oldHeader, newHeader } = parseDiffGitHeader(first);
  let minusPath: string | null = null;
  let plusPath: string | null = null;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let isNew = false;
  let isDeleted = false;
  let binary = false;
  let inHunk = false;
  let oldCursor = 0;
  let newCursor = 0;
  let addedLines = 0;
  let removedLines = 0;
  const lines: GitDiffLine[] = [];

  for (let i = 1; i < sectionLines.length; i += 1) {
    const line = sectionLines[i] ?? '';
    if (!inHunk) {
      if (line.startsWith('new file mode ')) {
        isNew = true;
        continue;
      }
      if (line.startsWith('deleted file mode ')) {
        isDeleted = true;
        continue;
      }
      if (line.startsWith('rename from ')) {
        renameFrom = unquoteGitPath(line.slice('rename from '.length));
        continue;
      }
      if (line.startsWith('rename to ')) {
        renameTo = unquoteGitPath(line.slice('rename to '.length));
        continue;
      }
      if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
        binary = true;
        continue;
      }
      if (line.startsWith('--- ')) {
        const target = line.slice('--- '.length).trim();
        if (target === '/dev/null') isNew = true;
        else minusPath = stripDiffPrefix(target, 'a/');
        continue;
      }
      if (line.startsWith('+++ ')) {
        const target = line.slice('+++ '.length).trim();
        if (target === '/dev/null') isDeleted = true;
        else plusPath = stripDiffPrefix(target, 'b/');
        continue;
      }
    }

    const hunk = HUNK_PATTERN.exec(line);
    if (hunk) {
      inHunk = true;
      oldCursor = Number.parseInt(hunk[1] ?? '1', 10);
      newCursor = Number.parseInt(hunk[2] ?? '1', 10);
      lines.push({ type: 'hunk', oldLine: null, newLine: null, text: line });
      continue;
    }

    if (!inHunk) continue;
    if (line === '\\ No newline at end of file') continue;

    if (line.startsWith('+')) {
      lines.push({ type: 'add', oldLine: null, newLine: newCursor, text: line.slice(1) });
      newCursor += 1;
      addedLines += 1;
      continue;
    }
    if (line.startsWith('-')) {
      lines.push({ type: 'del', oldLine: oldCursor, newLine: null, text: line.slice(1) });
      oldCursor += 1;
      removedLines += 1;
      continue;
    }
    if (line.startsWith(' ') || line === '') {
      lines.push({
        type: 'ctx',
        oldLine: oldCursor,
        newLine: newCursor,
        text: line.startsWith(' ') ? line.slice(1) : '',
      });
      oldCursor += 1;
      newCursor += 1;
    }
  }

  const status: GitFileStatus = isNew
    ? 'added'
    : isDeleted
      ? 'deleted'
      : renameFrom !== null && renameTo !== null
        ? 'renamed'
        : 'modified';
  const path = renameTo ?? plusPath ?? minusPath ?? newHeader;
  const candidateOldPath = renameFrom ?? (minusPath && minusPath !== path ? minusPath : oldHeader);
  const oldPath = status === 'renamed' ? candidateOldPath : null;

  return {
    path,
    oldPath,
    status,
    binary,
    addedLines,
    removedLines,
    lines,
  };
}

export function splitFilePath(path: string): { fileName: string; dirName: string | null } {
  const normalized = path.replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex === -1) return { fileName: normalized, dirName: null };
  if (slashIndex === 0) return { fileName: normalized.slice(1), dirName: null };
  return {
    fileName: normalized.slice(slashIndex + 1),
    dirName: normalized.slice(0, slashIndex),
  };
}

export function parseUnifiedGitDiff(input: {
  diff: string;
  changedFiles?: readonly string[];
}): ParsedFileDiff[] {
  const parsed: ParsedFileDiff[] = [];
  const seenPaths = new Set<string>();
  const rawLines = input.diff.replace(/\r\n/g, '\n').split('\n');
  let section: string[] = [];

  const flushSection = () => {
    if (section.length === 0) return;
    const item = parseDiffSection(section);
    section = [];
    if (!item) return;
    parsed.push(item);
    seenPaths.add(item.path);
  };

  for (const line of rawLines) {
    if (line.startsWith('diff --git ')) {
      flushSection();
      section.push(line);
    } else if (section.length > 0) {
      section.push(line);
    }
  }
  flushSection();

  for (const filePath of input.changedFiles ?? []) {
    if (filePath === '' || seenPaths.has(filePath)) continue;
    seenPaths.add(filePath);
    parsed.push({
      path: filePath,
      oldPath: null,
      status: 'modified',
      binary: false,
      addedLines: 0,
      removedLines: 0,
      lines: [],
    });
  }

  return parsed;
}

export function summarizeGitChanges(files: readonly ParsedFileDiff[]): GitChangesSummary {
  let addedLines = 0;
  let removedLines = 0;
  for (const file of files) {
    addedLines += file.addedLines;
    removedLines += file.removedLines;
  }
  return {
    fileCount: files.length,
    addedLines,
    removedLines,
  };
}
