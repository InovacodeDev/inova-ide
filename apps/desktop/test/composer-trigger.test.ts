import { expect, test } from 'vitest';
import {
  applyCommandSuggestion,
  applyFileSuggestion,
  buildPromptWithAttachedFiles,
  detachFileTrigger,
  detectComposerTrigger,
  filterCommands,
  isSameComposerTrigger,
  parseMessageFileSegments,
} from '../src/renderer/composer-trigger.js';
import type { ProjectCommandView } from '../src/shared/api.js';

test('detectComposerTrigger recognizes @file tokens at start or after whitespace', () => {
  expect(detectComposerTrigger('@cha', 4)).toEqual({
    kind: 'file',
    query: 'cha',
    start: 0,
    end: 4,
  });
  expect(detectComposerTrigger('revise @src/app', 15)).toEqual({
    kind: 'file',
    query: 'src/app',
    start: 7,
    end: 15,
  });
  expect(detectComposerTrigger('email@host.com', 14)).toBeNull();
  expect(detectComposerTrigger('revise @src/app agora', 21)).toBeNull();
});

test('detectComposerTrigger recognizes /command only at start of line', () => {
  expect(detectComposerTrigger('/rev', 4)).toEqual({
    kind: 'command',
    query: 'rev',
    start: 0,
    end: 4,
  });
  expect(detectComposerTrigger('linha 1\n/dep', 12)).toEqual({
    kind: 'command',
    query: 'dep',
    start: 8,
    end: 12,
  });
  expect(detectComposerTrigger('veja /etc/hosts', 15)).toBeNull();
});

test('applyFileSuggestion replaces @query with @path and trailing space', () => {
  const trigger = { kind: 'file' as const, query: 'app', start: 4, end: 8 };
  expect(applyFileSuggestion({ text: 'ver @app hoje', trigger, filePath: 'src/app.ts' })).toEqual({
    text: 'ver @src/app.ts hoje',
    cursor: 16,
  });
});

test('applyCommandSuggestion expands command body into composer', () => {
  const command: ProjectCommandView = {
    name: 'review',
    description: 'Code review',
    source: 'claude',
    kind: 'command',
    body: 'Review $ARGUMENTS carefully.',
  };
  const trigger = { kind: 'command' as const, query: 'rev', start: 0, end: 4 };
  expect(applyCommandSuggestion({ text: '/rev', trigger, command })).toEqual({
    text: 'Review  carefully.',
    cursor: 18,
  });
});

test('filterCommands matches name and description case-insensitively', () => {
  const commands: ProjectCommandView[] = [
    { name: 'deploy', description: 'Deploy service', source: 'claude', kind: 'command', body: 'x' },
    { name: 'audit', description: 'Security review', source: 'gemini', kind: 'skill', body: 'y' },
  ];
  expect(filterCommands(commands, 'sec').map((c) => c.name)).toEqual(['audit']);
  expect(filterCommands(commands, 'dep').map((c) => c.name)).toEqual(['deploy']);
});

test('isSameComposerTrigger compares triggers by value so unchanged cursor does not reset selection', () => {
  const base = detectComposerTrigger('@docs/', 6);
  const repeated = detectComposerTrigger('@docs/', 6);
  const edited = detectComposerTrigger('@docs/a', 7);
  expect(isSameComposerTrigger(null, null)).toBe(true);
  expect(isSameComposerTrigger(base, null)).toBe(false);
  expect(isSameComposerTrigger(null, repeated)).toBe(false);
  expect(isSameComposerTrigger(base, repeated)).toBe(true);
  expect(isSameComposerTrigger(base, edited)).toBe(false);
});

test('detachFileTrigger removes @query token without corrupting surrounding spaces', () => {
  expect(
    detachFileTrigger({
      text: '@.prett',
      trigger: { kind: 'file', query: '.prett', start: 0, end: 7 },
    }),
  ).toEqual({ text: '', cursor: 0 });

  expect(
    detachFileTrigger({
      text: 'ver @src/ap hoje',
      trigger: { kind: 'file', query: 'src/ap', start: 4, end: 11 },
    }),
  ).toEqual({ text: 'ver hoje', cursor: 4 });
});

test('buildPromptWithAttachedFiles combines deduplicated files and prompt text', () => {
  expect(buildPromptWithAttachedFiles({ text: '', files: ['.prettierrc'] })).toBe('@.prettierrc');
  expect(
    buildPromptWithAttachedFiles({
      text: 'Explique @.prettierrc aqui',
      files: ['.prettierrc', 'docs/a.md', 'docs/a.md'],
    }),
  ).toBe('@docs/a.md\nExplique @.prettierrc aqui');
});

test('parseMessageFileSegments extracts relative file tags while preserving emails and punctuation', () => {
  expect(parseMessageFileSegments('@.prettierrc')).toEqual([{ kind: 'file', path: '.prettierrc' }]);
  expect(parseMessageFileSegments('Revise @src/app.ts. E envie para tito@inovacode.dev')).toEqual([
    { kind: 'text', value: 'Revise ' },
    { kind: 'file', path: 'src/app.ts' },
    { kind: 'text', value: '. E envie para tito@inovacode.dev' },
  ]);
});
