import { expandCommandPrompt } from '@inova/core/command-prompt';
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

export function applyFileSuggestion(input: {
  text: string;
  trigger: ComposerTrigger;
  filePath: string;
}): { text: string; cursor: number } {
  const { text, trigger, filePath } = input;
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  const inserted = after.startsWith(' ') ? `@${filePath}` : `@${filePath} `;
  const nextText = `${before}${inserted}${after}`;
  const nextCursor = before.length + `@${filePath} `.length;
  return { text: nextText, cursor: nextCursor };
}

export function applyCommandSuggestion(input: {
  text: string;
  trigger: ComposerTrigger;
  command: ProjectCommandView;
}): { text: string; cursor: number } {
  const { text, trigger, command } = input;
  const expanded = expandCommandPrompt(command.body, '');
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  return {
    text: `${before}${expanded}${after}`,
    cursor: before.length + expanded.length,
  };
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
