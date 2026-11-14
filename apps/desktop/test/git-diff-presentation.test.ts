import { describe, expect, test } from 'vitest';
import {
  parseUnifiedGitDiff,
  splitFilePath,
  summarizeGitChanges,
} from '../src/renderer/git-diff-presentation';

describe('splitFilePath', () => {
  test('separates file name and directory path', () => {
    expect(splitFilePath('apps/desktop/src/renderer/App.tsx')).toEqual({
      fileName: 'App.tsx',
      dirName: 'apps/desktop/src/renderer',
    });
    expect(splitFilePath('README.md')).toEqual({
      fileName: 'README.md',
      dirName: null,
    });
  });
});

describe('parseUnifiedGitDiff', () => {
  test('parses modified, added, deleted, renamed, and binary sections', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 1111111..2222222 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -10,3 +10,4 @@ function run() {',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' return a + b;',
      '@@ -30,2 +31,1 @@ function end() {',
      '-oldTail();',
      ' done();',
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+export const ok = true;',
      '+export const version = 2;',
      'diff --git a/src/old.ts b/src/old.ts',
      'deleted file mode 100644',
      'index 4444444..0000000',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-export const legacy = 1;',
      '-export const dead = 2;',
      'diff --git a/src/legacy.ts b/src/modern.ts',
      'similarity index 90%',
      'rename from src/legacy.ts',
      'rename to src/modern.ts',
      '--- a/src/legacy.ts',
      '+++ b/src/modern.ts',
      '@@ -1,1 +1,1 @@',
      '-export const name = "legacy";',
      '+export const name = "modern";',
      'diff --git a/assets/logo.png b/assets/logo.png',
      'new file mode 100644',
      'index 0000000..5555555',
      'Binary files /dev/null and b/assets/logo.png differ',
    ].join('\n');

    const files = parseUnifiedGitDiff({
      diff,
      changedFiles: ['src/app.ts', 'src/extra-unparsed.txt'],
    });

    expect(files).toHaveLength(6);

    expect(files[0]).toMatchObject({
      path: 'src/app.ts',
      oldPath: null,
      status: 'modified',
      binary: false,
      addedLines: 2,
      removedLines: 2,
    });
    expect(files[0]?.lines).toEqual([
      { type: 'hunk', oldLine: null, newLine: null, text: '@@ -10,3 +10,4 @@ function run() {' },
      { type: 'ctx', oldLine: 10, newLine: 10, text: 'const a = 1;' },
      { type: 'del', oldLine: 11, newLine: null, text: 'const b = 2;' },
      { type: 'add', oldLine: null, newLine: 11, text: 'const b = 3;' },
      { type: 'add', oldLine: null, newLine: 12, text: 'const c = 4;' },
      { type: 'ctx', oldLine: 12, newLine: 13, text: 'return a + b;' },
      { type: 'hunk', oldLine: null, newLine: null, text: '@@ -30,2 +31,1 @@ function end() {' },
      { type: 'del', oldLine: 30, newLine: null, text: 'oldTail();' },
      { type: 'ctx', oldLine: 31, newLine: 31, text: 'done();' },
    ]);

    expect(files[1]).toMatchObject({
      path: 'src/new.ts',
      status: 'added',
      addedLines: 2,
      removedLines: 0,
    });

    expect(files[2]).toMatchObject({
      path: 'src/old.ts',
      status: 'deleted',
      addedLines: 0,
      removedLines: 2,
    });

    expect(files[3]).toMatchObject({
      path: 'src/modern.ts',
      oldPath: 'src/legacy.ts',
      status: 'renamed',
      addedLines: 1,
      removedLines: 1,
    });

    expect(files[4]).toMatchObject({
      path: 'assets/logo.png',
      status: 'added',
      binary: true,
      addedLines: 0,
      removedLines: 0,
      lines: [],
    });

    expect(files[5]).toEqual({
      path: 'src/extra-unparsed.txt',
      oldPath: null,
      status: 'modified',
      binary: false,
      addedLines: 0,
      removedLines: 0,
      lines: [],
    });

    expect(summarizeGitChanges(files)).toEqual({
      fileCount: 6,
      addedLines: 5,
      removedLines: 5,
    });
  });
});
