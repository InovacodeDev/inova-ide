import { expect, test } from 'vitest';
import {
  applyCommandSuggestion,
  applyFileSuggestion,
  detectComposerTrigger,
  filterCommands,
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
