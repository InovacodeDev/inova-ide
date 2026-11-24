import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createZipBuffer } from '@inova/core/library/index';
import type { CommandRunner } from '@inova/core/providers';
import { saveStore } from '@inova/core/store';
import { createLibraryHandlers } from '../src/main/library-handlers.js';
import {
  MAX_DROPPED_ZIPS,
  extractDroppedFiles,
  isZipFileName,
  resolveDroppedLibraryZips,
  summarizeZipImportBatch,
} from '../src/renderer/library-state.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-zip-drop-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fakeFile(name: string): File {
  return { name } as File;
}

describe('library zip drag-and-drop edge cases', () => {
  test('lida com transferências vazias, nulas e itens não-arquivo sem lançar erro', () => {
    expect(extractDroppedFiles(null)).toEqual([]);
    expect(extractDroppedFiles(undefined)).toEqual([]);
    expect(extractDroppedFiles({})).toEqual([]);
    expect(
      extractDroppedFiles({
        items: [
          { kind: 'string', getAsFile: () => null },
          { kind: 'file', getAsFile: () => null },
        ],
      }),
    ).toEqual([]);
    expect(
      resolveDroppedLibraryZips({
        files: [],
        resolvePath: () => '',
      }),
    ).toEqual({ kind: 'empty' });
  });

  test('recupera exceção em resolvePath e trata arquivo como não resolvido', () => {
    const resolved = resolveDroppedLibraryZips({
      files: [{ name: 'skill.zip', isDirectory: false }],
      resolvePath: () => {
        throw new Error('virtual file has no disk path');
      },
    });
    expect(resolved).toEqual({ kind: 'unresolvable', count: 1 });
  });

  test('valida nomes limítrofes, barras invertidas do Windows e espaços extras', () => {
    expect(isZipFileName('.zip')).toBe(false);
    expect(isZipFileName('/tmp/.zip')).toBe(false);
    expect(isZipFileName('archive.tar.gz')).toBe(false);
    expect(isZipFileName('skill.zip.tmp')).toBe(false);
    expect(isZipFileName('  C:\\skills\\my-skill.ZIP  ')).toBe(true);

    const win = resolveDroppedLibraryZips({
      files: [{ name: 'my-skill.ZIP', isDirectory: false }],
      resolvePath: () => '  C:\\skills\\my-skill.ZIP  ',
    });
    expect(win).toEqual({
      kind: 'ready',
      zipPaths: ['C:\\skills\\my-skill.ZIP'],
      rejectedNames: [],
      unresolvableCount: 0,
    });
  });

  test('filtra lote misto preservando válidos únicos e contabilizando rejeitados e não resolvidos', () => {
    const resolved = resolveDroppedLibraryZips({
      files: [
        { name: 'one.zip', isDirectory: false },
        { name: 'one-dup.zip', isDirectory: false },
        { name: 'notes.md', isDirectory: false },
        { name: 'folder.zip', isDirectory: true },
        { name: 'virtual.zip', isDirectory: false },
        { name: 'two.ZIP', isDirectory: false },
      ],
      resolvePath: (entry) => {
        if (entry.name === 'one-dup.zip') return '/tmp/one.zip';
        if (entry.name === 'virtual.zip') return '   ';
        return `/tmp/${entry.name}`;
      },
    });

    expect(resolved).toEqual({
      kind: 'ready',
      zipPaths: ['/tmp/one.zip', '/tmp/two.ZIP'],
      rejectedNames: ['notes.md', 'folder.zip'],
      unresolvableCount: 1,
    });
  });

  test('bloqueia lote acima do limite MAX_DROPPED_ZIPS', () => {
    const files = Array.from({ length: MAX_DROPPED_ZIPS + 1 }, (_, index) => ({
      name: `skill-${index}.zip`,
      isDirectory: false,
    }));
    const resolved = resolveDroppedLibraryZips({
      files,
      resolvePath: (entry) => `/tmp/${entry.name}`,
    });
    expect(resolved).toEqual({
      kind: 'too-many',
      count: MAX_DROPPED_ZIPS + 1,
      max: MAX_DROPPED_ZIPS,
    });
  });

  test('summarizeZipImportBatch mantém replacedSingle em sucesso único mesmo com outra falha', () => {
    expect(
      summarizeZipImportBatch([
        { fileName: 'good.zip', ok: true, itemName: 'Good', replaced: true },
        { fileName: 'bad.zip', ok: false, message: 'corrupt zip' },
      ]),
    ).toEqual({
      importedNames: ['Good'],
      replacedSingle: true,
      failures: [{ fileName: 'bad.zip', message: 'corrupt zip' }],
    });
  });

  test('importa skill de arquivo .zip resolvido via drag and drop sem acionar pickLibraryZip', async () => {
    const root = await tmp();
    const skillZipPath = join(root, 'drop-audit.zip');
    await writeFile(
      skillZipPath,
      createZipBuffer([
        {
          path: 'SKILL.md',
          data: '---\nname: drop-audit\ndescription: Skill dropped\n---\n\nRun $ARGUMENTS.',
        },
      ]),
    );
    const emptyZipPath = join(root, 'empty.zip');
    await writeFile(emptyZipPath, createZipBuffer([{ path: 'README.md', data: 'no skill' }]));

    await saveStore(root, { version: 1, accounts: [], projects: [] });
    const runner: CommandRunner = { run: vi.fn(async () => ({ notFound: true as const })) };
    const pickLibraryZip = vi.fn(async () => null as string | null);
    const handlers = createLibraryHandlers({
      root,
      baseEnv: async () => ({ PATH: '', HOME: root }),
      runner,
      pickLibraryZip,
    });

    const pathByName = new Map<string, string>([
      ['drop-audit.zip', skillZipPath],
      ['empty.zip', emptyZipPath],
    ]);
    const dropped = extractDroppedFiles({
      items: [
        {
          kind: 'file',
          getAsFile: () => fakeFile('drop-audit.zip'),
          webkitGetAsEntry: () => ({ isDirectory: false }),
        },
        {
          kind: 'file',
          getAsFile: () => fakeFile('empty.zip'),
          webkitGetAsEntry: () => ({ isDirectory: false }),
        },
        {
          kind: 'file',
          getAsFile: () => fakeFile('ignored.txt'),
          webkitGetAsEntry: () => ({ isDirectory: false }),
        },
      ],
    });
    const resolution = resolveDroppedLibraryZips({
      files: dropped,
      resolvePath: (entry) => pathByName.get(entry.name) ?? '',
    });

    expect(resolution).toEqual({
      kind: 'ready',
      zipPaths: [skillZipPath, emptyZipPath],
      rejectedNames: ['ignored.txt'],
      unresolvableCount: 0,
    });
    if (resolution.kind !== 'ready') throw new Error('expected ready');
    const [firstZip, secondZip] = resolution.zipPaths;
    if (!firstZip || !secondZip) throw new Error('expected two zip paths');

    const okImport = await handlers.importLibraryZip({ zipPath: firstZip });
    expect(okImport.ok).toBe(true);
    if (okImport.ok) {
      expect(okImport.value.kind).toBe('skill');
      expect(okImport.value.item.name).toBe('drop-audit');
    }

    const failedImport = await handlers.importLibraryZip({ zipPath: secondZip });
    expect(failedImport.ok).toBe(false);
    expect(pickLibraryZip).not.toHaveBeenCalled();
  });
});
