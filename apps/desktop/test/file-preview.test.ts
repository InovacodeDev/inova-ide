import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as XLSX from 'xlsx';
import {
  detectFileKind,
  parseCsvRows,
  parseWorkbookSheets,
  readFilePreviewContent,
} from '../src/main/file-preview.js';
import { parseOpenFilePath, parseReadFilePreview } from '../src/main/validation.js';

describe('parseCsvRows', () => {
  test('parses basic csv rows and columns', () => {
    const text = 'col1,col2\nval1,val2';
    expect(parseCsvRows({ text, delimiter: ',' })).toEqual([
      ['col1', 'col2'],
      ['val1', 'val2'],
    ]);
  });

  test('parses quoted commas correctly', () => {
    const text = '1,"foo,bar",baz';
    expect(parseCsvRows({ text, delimiter: ',' })).toEqual([['1', 'foo,bar', 'baz']]);
  });

  test('parses escaped quotes correctly', () => {
    const text = '1,"hello ""world""",test';
    expect(parseCsvRows({ text, delimiter: ',' })).toEqual([['1', 'hello "world"', 'test']]);
  });

  test('parses embedded newlines inside quotes', () => {
    const text = '1,"line1\nline2",3';
    expect(parseCsvRows({ text, delimiter: ',' })).toEqual([['1', 'line1\nline2', '3']]);
  });

  test('parses tsv with custom delimiter', () => {
    const text = 'col1\tcol2\nrow1\trow2';
    expect(parseCsvRows({ text, delimiter: '\t' })).toEqual([
      ['col1', 'col2'],
      ['row1', 'row2'],
    ]);
  });

  test('returns empty array on empty string', () => {
    expect(parseCsvRows({ text: '', delimiter: ',' })).toEqual([]);
  });
});

describe('parseWorkbookSheets', () => {
  test('parses workbook with multiple sheets from buffer', () => {
    const wb = XLSX.utils.book_new();
    const sheet1Data = [
      ['Name', 'Score'],
      ['Alice', 95],
      ['Bob', 80],
    ];
    const sheet2Data = [
      ['City', 'Country'],
      ['Sao Paulo', 'Brazil'],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
    const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
    XLSX.utils.book_append_sheet(wb, ws1, 'Students');
    XLSX.utils.book_append_sheet(wb, ws2, 'Locations');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const sheets = parseWorkbookSheets(buffer);

    expect(sheets).toHaveLength(2);
    expect(sheets[0]?.name).toBe('Students');
    expect(sheets[0]?.columns).toEqual(['A', 'B']);
    expect(sheets[0]?.rows).toEqual([
      ['Name', 'Score'],
      ['Alice', '95'],
      ['Bob', '80'],
    ]);
    expect(sheets[0]?.totalRows).toBe(3);
    expect(sheets[0]?.truncated).toBe(false);

    expect(sheets[1]?.name).toBe('Locations');
    expect(sheets[1]?.columns).toEqual(['A', 'B']);
    expect(sheets[1]?.rows).toEqual([
      ['City', 'Country'],
      ['Sao Paulo', 'Brazil'],
    ]);
    expect(sheets[1]?.totalRows).toBe(2);
    expect(sheets[1]?.truncated).toBe(false);
  });

  test('truncates sheets exceeding 10_000 rows', () => {
    const wb = XLSX.utils.book_new();
    const totalCount = 10_005;
    const largeData: string[][] = [];
    for (let i = 0; i < totalCount; i++) {
      largeData.push([`row_${i}`, `${i}`]);
    }
    const ws = XLSX.utils.aoa_to_sheet(largeData);
    XLSX.utils.book_append_sheet(wb, ws, 'Large');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const sheets = parseWorkbookSheets(buffer);

    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.totalRows).toBe(totalCount);
    expect(sheets[0]?.truncated).toBe(true);
    expect(sheets[0]?.rows).toHaveLength(10_000);
    expect(sheets[0]?.rows[0]).toEqual(['row_0', '0']);
    expect(sheets[0]?.rows[9999]).toEqual(['row_9999', '9999']);
  });

  test('throws cleanly on empty workbook or invalid buffer', () => {
    const emptyWb = XLSX.utils.book_new();
    const emptyWs = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(emptyWb, emptyWs, 'Empty');
    const buffer = XLSX.write(emptyWb, { type: 'buffer', bookType: 'xlsx' });
    expect(() => parseWorkbookSheets(buffer)).toThrow();
    expect(() => parseWorkbookSheets(new Uint8Array(0))).toThrow();
  });
});

describe('detectFileKind', () => {
  test('maps known extensions correctly', () => {
    const emptySample = new Uint8Array(0);
    expect(detectFileKind({ filePath: 'doc.html', sample: emptySample })).toBe('html');
    expect(detectFileKind({ filePath: 'page.htm', sample: emptySample })).toBe('html');
    expect(detectFileKind({ filePath: 'README.md', sample: emptySample })).toBe('markdown');
    expect(detectFileKind({ filePath: 'guide.mdx', sample: emptySample })).toBe('markdown');
    expect(detectFileKind({ filePath: 'data.xls', sample: emptySample })).toBe('spreadsheet');
    expect(detectFileKind({ filePath: 'data.xlsx', sample: emptySample })).toBe('spreadsheet');
    expect(detectFileKind({ filePath: 'data.xlsm', sample: emptySample })).toBe('spreadsheet');
    expect(detectFileKind({ filePath: 'data.ods', sample: emptySample })).toBe('spreadsheet');
    expect(detectFileKind({ filePath: 'data.csv', sample: emptySample })).toBe('spreadsheet');
    expect(detectFileKind({ filePath: 'data.tsv', sample: emptySample })).toBe('spreadsheet');
    expect(detectFileKind({ filePath: 'image.png', sample: emptySample })).toBe('image');
    expect(detectFileKind({ filePath: 'vector.svg', sample: emptySample })).toBe('image');
    expect(detectFileKind({ filePath: 'document.pdf', sample: emptySample })).toBe('pdf');
  });

  test('distinguishes text vs binary via sample bytes', () => {
    const textSample = new Uint8Array([104, 101, 108, 108, 111]);
    const binarySample = new Uint8Array([104, 0, 108, 108, 111]);
    expect(detectFileKind({ filePath: 'file.txt', sample: textSample })).toBe('text');
    expect(detectFileKind({ filePath: 'unknown.bin', sample: binarySample })).toBe('binary');
    expect(detectFileKind({ filePath: 'script.py', sample: textSample })).toBe('text');
  });
});

describe('readFilePreviewContent', () => {
  let tempBaseDir: string;
  let projectDir: string;
  let outsideDir: string;
  let projectFile: string;
  let htmlFile: string;
  let csvFile: string;
  let outsideFile: string;
  let symlinkFile: string;
  let largeFile: string;
  let pickedFile: string;
  let droppedFile: string;

  beforeAll(async () => {
    tempBaseDir = await mkdtemp(join(tmpdir(), 'inova-preview-test-'));
    projectDir = join(tempBaseDir, 'project');
    outsideDir = join(tempBaseDir, 'outside');

    const { mkdir } = await import('node:fs/promises');
    await mkdir(projectDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    projectFile = join(projectDir, 'sample.txt');
    await writeFile(projectFile, 'Hello, project!');

    htmlFile = join(projectDir, 'preview.html');
    await writeFile(htmlFile, '<h1>HTML Title</h1>');

    csvFile = join(projectDir, 'table.csv');
    await writeFile(csvFile, 'name,age\nAlice,30\nBob,25');

    outsideFile = join(outsideDir, 'secret.txt');
    await writeFile(outsideFile, 'secret contents');

    symlinkFile = join(projectDir, 'link-outside.txt');
    await symlink(outsideFile, symlinkFile);

    largeFile = join(projectDir, 'oversized.txt');
    const largeBuffer = Buffer.alloc(2 * 1024 * 1024 + 64, 0x61);
    await writeFile(largeFile, largeBuffer);

    pickedFile = join(outsideDir, 'picked.txt');
    await writeFile(pickedFile, 'picked content');

    droppedFile = join(outsideDir, 'dropped.txt');
    await writeFile(droppedFile, 'dropped content');
  });

  afterAll(async () => {
    await rm(tempBaseDir, { recursive: true, force: true });
  });

  test('resolves relative path in project and returns text', async () => {
    const result = await readFilePreviewContent({
      filePath: 'sample.txt',
      source: 'project',
      cwd: projectDir,
      allowedRoots: [projectDir],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('text');
    if (result.value.kind === 'text') {
      expect(result.value.content).toBe('Hello, project!');
      expect(result.value.name).toBe('sample.txt');
      expect(result.value.extension).toBe('.txt');
    }
  });

  test('resolves html preview with previewUrl callback', async () => {
    const createPreviewUrl = async (input: { rootDir: string; filePath: string }) => {
      return `inova-preview://view/test-token/${input.filePath.slice(input.rootDir.length + 1)}`;
    };

    const result = await readFilePreviewContent({
      filePath: 'preview.html',
      source: 'project',
      cwd: projectDir,
      allowedRoots: [projectDir],
      createPreviewUrl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('html');
    if (result.value.kind === 'html') {
      expect(result.value.content).toBe('<h1>HTML Title</h1>');
      expect(result.value.previewUrl).toContain('inova-preview://');
    }
  });

  test('resolves csv as spreadsheet', async () => {
    const result = await readFilePreviewContent({
      filePath: 'table.csv',
      source: 'project',
      cwd: projectDir,
      allowedRoots: [projectDir],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('spreadsheet');
    if (result.value.kind === 'spreadsheet') {
      expect(result.value.sheets).toHaveLength(1);
      expect(result.value.sheets[0]?.columns).toEqual(['A', 'B']);
      expect(result.value.sheets[0]?.rows).toEqual([
        ['name', 'age'],
        ['Alice', '30'],
        ['Bob', '25'],
      ]);
      expect(result.value.sheets[0]?.totalRows).toBe(3);
    }
  });

  test('strips leading UTF-8 BOM in csv files', async () => {
    const bomCsvFile = join(projectDir, 'bom-table.csv');
    await writeFile(bomCsvFile, '\uFEFFheader1,header2\nval1,val2');
    const result = await readFilePreviewContent({
      filePath: 'bom-table.csv',
      source: 'project',
      cwd: projectDir,
      allowedRoots: [projectDir],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('spreadsheet');
    if (result.value.kind === 'spreadsheet') {
      expect(result.value.sheets[0]?.rows[0]).toEqual(['header1', 'header2']);
    }
  });

  test('rejects path traversal escaping project allowed roots', async () => {
    const result = await readFilePreviewContent({
      filePath: '../outside/secret.txt',
      source: 'project',
      cwd: projectDir,
      allowedRoots: [projectDir],
    });
    expect(result.ok).toBe(false);
  });

  test('rejects symlinks pointing outside allowed roots', async () => {
    const result = await readFilePreviewContent({
      filePath: 'link-outside.txt',
      source: 'project',
      cwd: projectDir,
      allowedRoots: [projectDir],
    });
    expect(result.ok).toBe(false);
  });

  test('requires allowExternal match when source is picker', async () => {
    const allowed = new Set([pickedFile]);

    const accepted = await readFilePreviewContent({
      filePath: pickedFile,
      source: 'picker',
      allowExternal: allowed,
    });
    expect(accepted.ok).toBe(true);

    const rejected = await readFilePreviewContent({
      filePath: outsideFile,
      source: 'picker',
      allowExternal: allowed,
    });
    expect(rejected.ok).toBe(false);
  });

  test('accepts existing regular file when source is user-drop', async () => {
    const result = await readFilePreviewContent({
      filePath: droppedFile,
      source: 'user-drop',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('text');

    const missing = await readFilePreviewContent({
      filePath: join(outsideDir, 'nonexistent.txt'),
      source: 'user-drop',
    });
    expect(missing.ok).toBe(false);
  });

  test('returns too-large for text files exceeding 2 MB', async () => {
    const result = await readFilePreviewContent({
      filePath: 'oversized.txt',
      source: 'project',
      cwd: projectDir,
      allowedRoots: [projectDir],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('too-large');
  });
});

describe('validation: parseReadFilePreview and parseOpenFilePath', () => {
  test('accepts valid project source with relative path and optional ids', () => {
    const parsed = parseReadFilePreview({
      path: 'src/main.ts',
      source: 'project',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    });
    expect(parsed).toEqual({
      path: 'src/main.ts',
      source: 'project',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    });
  });

  test('accepts valid user-drop and picker with absolute path', () => {
    const absPath = resolve('/tmp/file.txt');
    expect(parseReadFilePreview({ path: absPath, source: 'user-drop' })).toEqual({
      path: absPath,
      source: 'user-drop',
    });
    expect(parseOpenFilePath({ path: absPath, source: 'picker' })).toEqual({
      path: absPath,
      source: 'picker',
    });
  });

  test('rejects relative path for picker or user-drop', () => {
    expect(parseReadFilePreview({ path: 'file.txt', source: 'picker' })).toBeUndefined();
    expect(parseOpenFilePath({ path: 'file.txt', source: 'user-drop' })).toBeUndefined();
  });

  test('rejects path containing null bytes or empty', () => {
    expect(parseReadFilePreview({ path: '', source: 'project' })).toBeUndefined();
    expect(parseReadFilePreview({ path: 'file\0.txt', source: 'project' })).toBeUndefined();
  });

  test('rejects unsafe projectId or sessionId', () => {
    expect(
      parseReadFilePreview({
        path: 'file.txt',
        source: 'project',
        projectId: '../escape',
      }),
    ).toBeUndefined();
    expect(
      parseOpenFilePath({
        path: 'file.txt',
        source: 'project',
        sessionId: 'bad/id',
      }),
    ).toBeUndefined();
  });
});
