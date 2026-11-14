import { expect, test } from 'vitest';
import {
  applyCommandSuggestion,
  applyFileSuggestion,
  buildPromptWithAttachedFiles,
  detachFileTrigger,
  detectComposerTrigger,
  filterCommands,
  filterSlashSuggestions,
  formatFileMention,
  isSameComposerTrigger,
  parseLeadingSlashTag,
  parseMessageFileSegments,
  resolveDroppedPath,
} from '../src/renderer/composer-trigger.js';
import { nativeSlashCommands } from '@inova/core/slash-commands';
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

test('filterSlashSuggestions lists provider commands before project commands', () => {
  const project: ProjectCommandView[] = [
    { name: 'clean', description: 'Limpeza', source: 'claude', kind: 'skill', body: 'x' },
  ];
  const result = filterSlashSuggestions({
    native: nativeSlashCommands('claude'),
    project,
    query: 'cl',
  });
  expect(result[0]).toMatchObject({ kind: 'native', command: { name: 'clear' } });
  expect(result.at(-1)).toMatchObject({ kind: 'project', command: { name: 'clean' } });
});

test('parseLeadingSlashTag matches only a known leading command', () => {
  const known = new Set(['review']);
  expect(parseLeadingSlashTag({ text: '/review agora', known })).toEqual({
    name: 'review',
    rest: 'agora',
  });
  expect(parseLeadingSlashTag({ text: '/review', known })).toEqual({ name: 'review', rest: '' });
  expect(parseLeadingSlashTag({ text: '/xyz oi', known })).toBeNull();
  expect(parseLeadingSlashTag({ text: 'oi /review', known })).toBeNull();
});

test('applyCommandSuggestion inserts the command name as a tag token', () => {
  const command: ProjectCommandView = {
    name: 'review',
    description: 'Code review',
    source: 'claude',
    kind: 'command',
    body: 'Review $ARGUMENTS carefully.',
  };
  const trigger = { kind: 'command' as const, query: 'rev', start: 0, end: 4 };
  expect(applyCommandSuggestion({ text: '/rev', trigger, command })).toEqual({
    text: '/review ',
    cursor: 8,
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

test('resolveDroppedPath mentions project files relatively and asks access for outside paths', () => {
  const cwd = '/Users/me/proj';
  expect(resolveDroppedPath({ path: '/Users/me/proj/src/a.ts', cwd, isDirectory: false })).toEqual({
    mention: 'src/a.ts',
    grantDir: null,
  });
  expect(resolveDroppedPath({ path: cwd, cwd: `${cwd}/`, isDirectory: true })).toEqual({
    mention: '.',
    grantDir: null,
  });
  expect(
    resolveDroppedPath({ path: '/Users/me/Downloads/doc.pdf', cwd, isDirectory: false }),
  ).toEqual({ mention: '/Users/me/Downloads/doc.pdf', grantDir: '/Users/me/Downloads' });
  expect(
    resolveDroppedPath({ path: '/Users/me/project-other/a.ts', cwd, isDirectory: false }).grantDir,
  ).toBe('/Users/me/project-other');
  expect(resolveDroppedPath({ path: '/Users/me/Shots', cwd, isDirectory: true }).grantDir).toBe(
    '/Users/me/Shots',
  );
  expect(resolveDroppedPath({ path: '/a.txt', cwd: null, isDirectory: false }).grantDir).toBe('/');
  expect(
    resolveDroppedPath({ path: 'C:\\proj\\src\\a.ts', cwd: 'C:\\proj', isDirectory: false }),
  ).toEqual({ mention: 'src\\a.ts', grantDir: null });
});

test('parseMessageFileSegments extracts relative file tags while preserving emails and punctuation', () => {
  expect(parseMessageFileSegments('@.prettierrc')).toEqual([{ kind: 'file', path: '.prettierrc' }]);
  expect(parseMessageFileSegments('Revise @src/app.ts. E envie para tito@inovacode.dev')).toEqual([
    { kind: 'text', value: 'Revise ' },
    { kind: 'file', path: 'src/app.ts' },
    { kind: 'text', value: '. E envie para tito@inovacode.dev' },
  ]);
});

const SHOT = '/Users/x/Desktop/Captura de Tela 2026-11-13 às 15.22.49.png';

test('formatFileMention quotes only paths that break the token', () => {
  expect(formatFileMention('src/a.ts')).toBe('@src/a.ts');
  expect(formatFileMention(SHOT)).toBe(`@"${SHOT}"`);
  expect(formatFileMention('docs/meu arquivo.md')).toBe('@"docs/meu arquivo.md"');
  expect(formatFileMention('a (1).png')).toBe('@"a (1).png"');
});

test('buildPromptWithAttachedFiles quotes paths with spaces and dedups quoted mentions', () => {
  expect(buildPromptWithAttachedFiles({ text: 'Veja', files: [SHOT] })).toBe(`@"${SHOT}"\nVeja`);
  expect(buildPromptWithAttachedFiles({ text: `Veja @"${SHOT}"`, files: [SHOT] })).toBe(
    `Veja @"${SHOT}"`,
  );
});

test('parseMessageFileSegments reads quoted mentions with spaces and non-ASCII', () => {
  expect(parseMessageFileSegments(`@"${SHOT}"\nVeja`)).toEqual([
    { kind: 'file', path: SHOT },
    { kind: 'text', value: '\nVeja' },
  ]);
  expect(parseMessageFileSegments('Abra @"docs/meu arquivo.md".')).toEqual([
    { kind: 'text', value: 'Abra ' },
    { kind: 'file', path: 'docs/meu arquivo.md' },
    { kind: 'text', value: '.' },
  ]);
  expect(parseMessageFileSegments('Abra @"docs/meu arquivo.md, depois')).toEqual([
    { kind: 'text', value: 'Abra @"docs/meu arquivo.md, depois' },
  ]);
});

test('applyFileSuggestion quotes paths with spaces', () => {
  const trigger = detectComposerTrigger('ver @cap', 8);
  if (trigger === null) throw new Error('trigger expected');
  expect(applyFileSuggestion({ text: 'ver @cap', trigger, filePath: 'img/a b.png' })).toEqual({
    text: 'ver @"img/a b.png" ',
    cursor: 'ver @"img/a b.png" '.length,
  });
});
