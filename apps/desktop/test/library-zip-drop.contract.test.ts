import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { LibrarySection } from '../src/renderer/LibrarySection';
import { translate } from '../src/renderer/i18n';
import {
  extractDroppedFiles,
  hasFileDragPayload,
  isZipFileName,
  resolveDroppedLibraryZips,
  summarizeZipImportBatch,
} from '../src/renderer/library-state';

vi.mock('../src/renderer/useLibrary', () => ({
  libraryCall: vi.fn(),
  useLibrary: () => ({
    listing: { items: [], pluginRecipes: {}, invalidItems: [] },
    loadError: null,
    reload: async () => undefined,
  }),
}));

function fakeFile(name: string): File {
  return { name } as File;
}

describe('library zip drag-and-drop contract', () => {
  test('isZipFileName aceita apenas nomes válidos terminados em .zip', () => {
    expect(isZipFileName('skill.zip')).toBe(true);
    expect(isZipFileName('PACK.ZIP')).toBe(true);
    expect(isZipFileName('/Users/dev/skills/audit.zip')).toBe(true);
    expect(isZipFileName('readme.md')).toBe(false);
    expect(isZipFileName('.zip')).toBe(false);
    expect(isZipFileName('skill.zip.bak')).toBe(false);
    expect(isZipFileName('')).toBe(false);
  });

  test('hasFileDragPayload identifica drag contendo arquivos', () => {
    expect(hasFileDragPayload(['Files'])).toBe(true);
    expect(hasFileDragPayload(['text/plain', 'Files'])).toBe(true);
    expect(hasFileDragPayload(['text/plain'])).toBe(false);
    expect(hasFileDragPayload([])).toBe(false);
  });

  test('extractDroppedFiles prioriza items com isDirectory e faz fallback para files', () => {
    const zip = fakeFile('skill.zip');
    const dir = fakeFile('plugin-dir.zip');
    const fromItems = extractDroppedFiles({
      items: [
        {
          kind: 'file',
          getAsFile: () => zip,
          webkitGetAsEntry: () => ({ isDirectory: false }),
        },
        {
          kind: 'file',
          getAsFile: () => dir,
          webkitGetAsEntry: () => ({ isDirectory: true }),
        },
      ],
    });
    expect(fromItems).toEqual([
      { file: zip, name: 'skill.zip', isDirectory: false },
      { file: dir, name: 'plugin-dir.zip', isDirectory: true },
    ]);

    const fallback = extractDroppedFiles({ files: [zip] });
    expect(fallback).toEqual([{ file: zip, name: 'skill.zip', isDirectory: false }]);
  });

  test('resolveDroppedLibraryZips resolve único e múltiplos zips, deduplica e rejeita inválidos ou pastas', () => {
    const single = resolveDroppedLibraryZips({
      files: [{ name: 'audit.zip', isDirectory: false }],
      resolvePath: () => '/tmp/audit.zip',
    });
    expect(single).toEqual({
      kind: 'ready',
      zipPaths: ['/tmp/audit.zip'],
      rejectedNames: [],
      unresolvableCount: 0,
    });

    const multiple = resolveDroppedLibraryZips({
      files: [
        { name: 'a.zip', isDirectory: false },
        { name: 'b.ZIP', isDirectory: false },
        { name: 'a.zip', isDirectory: false },
      ],
      resolvePath: (entry) => `/tmp/${entry.name.toLowerCase()}`,
    });
    expect(multiple).toEqual({
      kind: 'ready',
      zipPaths: ['/tmp/a.zip', '/tmp/b.zip'],
      rejectedNames: [],
      unresolvableCount: 0,
    });

    const nonZip = resolveDroppedLibraryZips({
      files: [{ name: 'notes.txt', isDirectory: false }],
      resolvePath: () => '/tmp/notes.txt',
    });
    expect(nonZip).toEqual({
      kind: 'invalid-files',
      rejectedNames: ['notes.txt'],
    });

    const dirNamedZip = resolveDroppedLibraryZips({
      files: [{ name: 'plugin.zip', isDirectory: true }],
      resolvePath: () => '/tmp/plugin.zip',
    });
    expect(dirNamedZip).toEqual({
      kind: 'invalid-files',
      rejectedNames: ['plugin.zip'],
    });

    const unresolvable = resolveDroppedLibraryZips({
      files: [{ name: 'audit.zip', isDirectory: false }],
      resolvePath: () => '',
    });
    expect(unresolvable).toEqual({
      kind: 'unresolvable',
      count: 1,
    });
  });

  test('summarizeZipImportBatch consolida importações unitárias, em lote e falhas', () => {
    expect(
      summarizeZipImportBatch([
        { fileName: 'audit.zip', ok: true, itemName: 'Audit', replaced: false },
      ]),
    ).toEqual({
      importedNames: ['Audit'],
      replacedSingle: false,
      failures: [],
    });

    expect(
      summarizeZipImportBatch([
        { fileName: 'audit.zip', ok: true, itemName: 'Audit', replaced: true },
      ]),
    ).toEqual({
      importedNames: ['Audit'],
      replacedSingle: true,
      failures: [],
    });

    expect(
      summarizeZipImportBatch([
        { fileName: 'a.zip', ok: true, itemName: 'Alpha', replaced: true },
        { fileName: 'b.zip', ok: true, itemName: 'Beta', replaced: false },
        { fileName: 'c.zip', ok: false, message: 'invalid zip' },
      ]),
    ).toEqual({
      importedNames: ['Alpha', 'Beta'],
      replacedSingle: false,
      failures: [{ fileName: 'c.zip', message: 'invalid zip' }],
    });
  });

  test('LibrarySection renderiza a zona de soltura e preserva o botão Importar ZIP', () => {
    const html = renderToStaticMarkup(
      createElement(LibrarySection, {
        accounts: [],
        projects: [],
        onRun: async () => ({ ok: false as const, message: 'x' }),
      }),
    );
    expect(html).toContain('library-dropzone');
    expect(html).toContain(translate('pt-BR', 'library.dropZip.hint'));
    expect(html).toContain(translate('pt-BR', 'library.importZip'));
  });
});

describe('textos de drag and drop de zip existem nos dois idiomas', () => {
  test.each([
    'library.importZipBatchSuccess',
    'library.importZipPartialError',
    'library.dropZip.hint',
    'library.dropZip.overlay',
    'library.dropZip.invalidFiles',
    'library.dropZip.ignoredFiles',
    'library.dropZip.unresolvable',
    'library.dropZip.tooMany',
  ] as const)('%s', (key) => {
    const pt = translate('pt-BR', key, { count: 2, names: 'a', name: 'a', message: 'm', max: 20 });
    const en = translate('en-US', key, { count: 2, names: 'a', name: 'a', message: 'm', max: 20 });
    expect(pt).not.toBe('');
    expect(en).not.toBe('');
    expect(en).not.toBe(pt);
  });
});
