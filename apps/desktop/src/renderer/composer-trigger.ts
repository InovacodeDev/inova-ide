import { splitLeadingSlash } from '@inova/core/command-prompt';
import type { NativeSlashCommand } from '@inova/core/slash-commands';
import type { ProjectCommandView } from '../shared/api';

export type ComposerTrigger =
  | { kind: 'file'; query: string; start: number; end: number }
  | { kind: 'command'; query: string; start: number; end: number };

// REGEX: match @token at start of text or preceded by whitespace with no spaces inside
const FILE_TRIGGER_PATTERN = /(?:^|\s)(@[^\s]*)$/;
// REGEX: match /command token at the start of the current line up to cursor
const COMMAND_TRIGGER_PATTERN = /(?:^|\n)(\/[^\s]*)$/;

export function detectComposerTrigger(text: string, cursor: number): ComposerTrigger | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const prefix = text.slice(0, safeCursor);

  const cmdMatch = COMMAND_TRIGGER_PATTERN.exec(prefix);
  if (cmdMatch?.[1] !== undefined) {
    const token = cmdMatch[1];
    return {
      kind: 'command',
      query: token.slice(1),
      start: safeCursor - token.length,
      end: safeCursor,
    };
  }

  const fileMatch = FILE_TRIGGER_PATTERN.exec(prefix);
  if (fileMatch?.[1] !== undefined) {
    const token = fileMatch[1];
    return {
      kind: 'file',
      query: token.slice(1),
      start: safeCursor - token.length,
      end: safeCursor,
    };
  }

  return null;
}

export function isSameComposerTrigger(
  a: ComposerTrigger | null,
  b: ComposerTrigger | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.kind === b.kind && a.query === b.query && a.start === b.start && a.end === b.end;
}

export type MessageFileSegment = { kind: 'text'; value: string } | { kind: 'file'; path: string };

const KNOWN_EXTENSIONLESS_FILES = new Set([
  'README',
  'LICENSE',
  'Makefile',
  'Dockerfile',
  'Procfile',
]);

// REGEX: match @"quoted path" or @path after start, whitespace, or opening delimiter; an unterminated quote never matches
const MESSAGE_FILE_PATTERN = /(^|[\s([{"'])@(?:"([^"\n]+)"|([^\s()[\]{}<>"'`]+))/g;
// REGEX: characters that break an unquoted @path token
const MENTION_BREAKING_CHARS = /[\s()[\]{}<>"'`]/;

export function formatFileMention(path: string): string {
  if (!MENTION_BREAKING_CHARS.test(path) || path.includes('"')) return `@${path}`;
  return `@"${path}"`;
}

function isLikelyRelativeFilePath(candidate: string): boolean {
  return (
    candidate.includes('/') || candidate.includes('.') || KNOWN_EXTENSIONLESS_FILES.has(candidate)
  );
}

export function detachFileTrigger(input: { text: string; trigger: ComposerTrigger }): {
  text: string;
  cursor: number;
} {
  const { text, trigger } = input;
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  const trimmedAfter = before.endsWith(' ') && after.startsWith(' ') ? after.slice(1) : after;
  return { text: `${before}${trimmedAfter}`, cursor: before.length };
}

export interface DroppedPath {
  mention: string;
  grantDir: string | null;
}

export function resolveDroppedPath(input: {
  path: string;
  cwd: string | null;
  isDirectory: boolean;
}): DroppedPath {
  const { path, cwd, isDirectory } = input;
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/';
  const root = cwd === null ? null : cwd.replace(/[\\/]+$/, '');
  if (root !== null && path === root) return { mention: '.', grantDir: null };
  if (root !== null && root !== '' && path.startsWith(`${root}${separator}`)) {
    return { mention: path.slice(root.length + 1), grantDir: null };
  }
  const parentEnd = path.lastIndexOf(separator);
  const parent = parentEnd <= 0 ? separator : path.slice(0, parentEnd);
  return { mention: path, grantDir: isDirectory ? path : parent };
}

export function buildPromptWithAttachedFiles(input: {
  text: string;
  files: readonly string[];
}): string {
  const body = input.text.trim();
  const seen = new Set<string>();
  const uniqueFiles: string[] = [];
  for (const file of input.files) {
    if (file === '' || seen.has(file)) continue;
    seen.add(file);
    uniqueFiles.push(file);
  }
  const existingMentions = new Set(
    parseMessageFileSegments(body)
      .filter(
        (segment): segment is Extract<MessageFileSegment, { kind: 'file' }> =>
          segment.kind === 'file',
      )
      .map((segment) => segment.path),
  );
  const prefixTokens = uniqueFiles
    .filter((file) => !existingMentions.has(file))
    .map(formatFileMention);
  if (prefixTokens.length === 0) return body;
  const prefix = prefixTokens.join(' ');
  return body === '' ? prefix : `${prefix}\n${body}`;
}

function appendTextSegment(segments: MessageFileSegment[], value: string): void {
  if (value === '') return;
  const previous = segments[segments.length - 1];
  if (previous?.kind === 'text') {
    previous.value += value;
    return;
  }
  segments.push({ kind: 'text', value });
}

export function parseMessageFileSegments(text: string): MessageFileSegment[] {
  const segments: MessageFileSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MESSAGE_FILE_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const lead = match[1] ?? '';
    const quotedCandidate = match[2];
    const rawCandidate = quotedCandidate ?? match[3] ?? '';
    const stripped =
      quotedCandidate === undefined ? rawCandidate.replace(/[.,;:!?]+$/, '') : rawCandidate;
    const trailingPunctuation = rawCandidate.slice(stripped.length);
    if (!isLikelyRelativeFilePath(stripped)) continue;
    const tokenStart = matchIndex + lead.length;
    const tokenLength =
      quotedCandidate === undefined ? 1 + stripped.length : match[0].length - lead.length;
    if (tokenStart > cursor) {
      appendTextSegment(segments, text.slice(cursor, tokenStart));
    }
    segments.push({ kind: 'file', path: stripped });
    cursor = tokenStart + tokenLength;
    if (trailingPunctuation !== '') {
      appendTextSegment(segments, trailingPunctuation);
      cursor += trailingPunctuation.length;
    }
  }
  if (cursor < text.length) {
    appendTextSegment(segments, text.slice(cursor));
  }
  return segments;
}

export function applyFileSuggestion(input: {
  text: string;
  trigger: ComposerTrigger;
  filePath: string;
}): { text: string; cursor: number } {
  const { text, trigger, filePath } = input;
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  const mention = formatFileMention(filePath);
  const inserted = after.startsWith(' ') ? mention : `${mention} `;
  const nextText = `${before}${inserted}${after}`;
  const nextCursor = before.length + mention.length + 1;
  return { text: nextText, cursor: nextCursor };
}

export function applyCommandSuggestion(input: {
  text: string;
  trigger: ComposerTrigger;
  command: Pick<ProjectCommandView, 'name'>;
}): { text: string; cursor: number } {
  const { text, trigger, command } = input;
  const tag = `/${command.name} `;
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  return {
    text: `${before}${tag}${after}`,
    cursor: before.length + tag.length,
  };
}

export type SlashSuggestion =
  | { kind: 'native'; command: NativeSlashCommand }
  | { kind: 'project'; command: ProjectCommandView };

export function filterSlashSuggestions(input: {
  native: readonly NativeSlashCommand[];
  project: readonly ProjectCommandView[];
  query: string;
}): SlashSuggestion[] {
  const normalized = input.query.trim().toLowerCase();
  const native = input.native.filter(
    (command) =>
      normalized === '' ||
      command.name.toLowerCase().includes(normalized) ||
      command.description.toLowerCase().includes(normalized),
  );
  return [
    ...native.map((command): SlashSuggestion => ({ kind: 'native', command })),
    ...filterCommands(input.project, input.query).map((command): SlashSuggestion => ({
      kind: 'project',
      command,
    })),
  ];
}

export function parseLeadingSlashTag(input: {
  text: string;
  known: ReadonlySet<string>;
}): { name: string; rest: string } | null {
  const parsed = splitLeadingSlash(input.text);
  return parsed !== null && input.known.has(parsed.name) ? parsed : null;
}

export function filterCommands(
  commands: readonly ProjectCommandView[],
  query: string,
): ProjectCommandView[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') return [...commands];
  return commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(normalized) ||
      cmd.description.toLowerCase().includes(normalized),
  );
}
