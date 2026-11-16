import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';
import type { ChatEvent } from './chat-types.js';
import {
  extractEditedPaths,
  sessionEditedRepoPaths,
  toRepoRelativePaths,
} from './session-files.js';

const exec = promisify(execFile);
const tempDirs: string[] = [];

function toolUse(name: string, input: unknown): ChatEvent {
  return {
    kind: 'tool-use',
    toolId: `${name}-${tempDirs.length}`,
    name,
    input: typeof input === 'string' ? input : JSON.stringify(input, null, 2),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('extractEditedPaths', () => {
  test('collects paths from file-editing tools of every provider and ignores the rest', () => {
    const events: ChatEvent[] = [
      { kind: 'user', text: 'oi', at: 't' },
      toolUse('Edit', { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' }),
      toolUse('Write', { file_path: '/repo/b.ts', content: 'x' }),
      toolUse('MultiEdit', { file_path: '/repo/a.ts', edits: [] }),
      toolUse('NotebookEdit', { notebook_path: '/repo/n.ipynb', new_source: '' }),
      toolUse('write_file', { file_path: 'rel/c.ts', content: 'x' }),
      toolUse('replace', { file_path: 'rel/d.ts', old_string: 'a', new_string: 'b' }),
      toolUse('edit', { filePath: '/repo/e.ts', oldString: 'a', newString: 'b' }),
      toolUse('write_to_file', { TargetFile: '/repo/f.ts', CodeContent: 'x' }),
      toolUse('file_change', {
        changes: [
          { path: '/repo/g.ts', kind: 'update' },
          { path: '/repo/h.ts', kind: 'delete' },
        ],
      }),
      toolUse(
        'apply_patch',
        '*** Begin Patch\n*** Update File: src/i.ts\n@@\n-a\n+b\n*** Add File: src/j.ts\n+x\n*** End Patch',
      ),
      toolUse('patch', { patchText: '--- a/k.ts\n+++ b/k.ts\n@@ -1 +1 @@\n-a\n+b\n' }),
      toolUse('Read', { file_path: '/repo/read-only.ts' }),
      toolUse('Bash', { command: 'echo x > /repo/shell.ts' }),
      toolUse('command_execution', 'bash -lc "touch shell.ts"'),
      toolUse('Edit', 'not json'),
      { kind: 'tool-result', toolId: 'x', output: '/repo/z.ts', isError: false },
    ];
    expect(extractEditedPaths(events)).toEqual([
      '/repo/a.ts',
      '/repo/b.ts',
      '/repo/n.ipynb',
      'rel/c.ts',
      'rel/d.ts',
      '/repo/e.ts',
      '/repo/f.ts',
      '/repo/g.ts',
      '/repo/h.ts',
      'src/i.ts',
      'src/j.ts',
      'k.ts',
    ]);
  });
});

describe('toRepoRelativePaths', () => {
  test('maps absolute and cwd-relative paths to repo-relative paths and drops outside paths', () => {
    expect(
      toRepoRelativePaths({
        paths: ['/alias/repo/pkg/a.ts', 'b.ts', '../top.ts', '/real/repo/c.ts', '/elsewhere/d.ts'],
        cwd: '/alias/repo/pkg',
        roots: [
          { dir: '/alias/repo/pkg', prefix: 'pkg/' },
          { dir: '/real/repo', prefix: '' },
          { dir: '/alias/repo', prefix: '' },
        ],
      }),
    ).toEqual(['pkg/a.ts', 'pkg/b.ts', 'top.ts', 'c.ts']);
  });
});

describe('sessionEditedRepoPaths', () => {
  test('resolves edited paths against the git root of the session cwd', async () => {
    const repo = await realpath(await mkdtemp(join(tmpdir(), 'inova-session-files-')));
    tempDirs.push(repo);
    await exec('git', ['init', '-b', 'main'], { cwd: repo });
    const pkg = join(repo, 'pkg');
    await mkdir(pkg);

    const paths = await sessionEditedRepoPaths({
      cwd: pkg,
      events: [
        toolUse('Edit', { file_path: join(pkg, 'a.ts') }),
        toolUse('Write', { file_path: 'b.ts' }),
        toolUse('Write', { file_path: join(repo, 'root.ts') }),
        toolUse('Write', { file_path: '/outside/x.ts' }),
      ],
    });
    expect(paths).toEqual(['pkg/a.ts', 'pkg/b.ts', 'root.ts']);
  });

  test('returns nothing when the session edited no files or the cwd is not a repo', async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), 'inova-session-files-plain-')));
    tempDirs.push(plain);
    expect(await sessionEditedRepoPaths({ cwd: plain, events: [] })).toEqual([]);
    expect(
      await sessionEditedRepoPaths({
        cwd: plain,
        events: [toolUse('Write', { file_path: join(plain, 'a.ts') })],
      }),
    ).toEqual([]);
  });
});
