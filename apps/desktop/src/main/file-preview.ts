import { open, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, resolve, sep } from 'node:path';
import * as XLSX from 'xlsx';
import type {
  FilePreview,
  FilePreviewKind,
  FilePreviewSource,
  Result,
  SpreadsheetSheet,
} from '../shared/api.js';
import { fail, ok } from './validation.js';

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_SPREADSHEET_BYTES = 20 * 1024 * 1024;
export const MAX_SHEET_ROWS = 10_000;
export const MAX_SHEET_COLS = 100;
const SAMPLE_SIZE = 512;

function isInsideRoot(rootReal: string, targetReal: string): boolean {
  return (
    targetReal === rootReal ||
    targetReal.startsWith(rootReal.endsWith(sep) ? rootReal : rootReal + sep)
  );
}

async function readSampleBytes(filePath: string, maxBytes: number): Promise<Uint8Array> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function isExternalPermitted(
  filePath: string,
  realPath: string,
  allowExternal?:
    | ReadonlySet<string>
    | readonly string[]
    | ((candidatePath: string) => boolean | Promise<boolean>),
): Promise<boolean> {
  if (!allowExternal) return false;
  if (typeof allowExternal === 'function') {
    return (await allowExternal(filePath)) || (await allowExternal(realPath));
  }
  if (allowExternal instanceof Set) {
    return allowExternal.has(filePath) || allowExternal.has(realPath);
  }
  if (Array.isArray(allowExternal)) {
    return allowExternal.includes(filePath) || allowExternal.includes(realPath);
  }
  return false;
}

export function parseCsvRows(input: { text: string; delimiter: string }): string[][] {
  const { text, delimiter } = input;
  if (text.length === 0) {
    return [];
  }
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  const delimLen = delimiter.length || 1;

  while (i < len) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      currentField += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (text.startsWith(delimiter, i)) {
      currentRow.push(currentField);
      currentField = '';
      i += delimLen;
      continue;
    }

    if (char === '\r') {
      if (i + 1 < len && text[i + 1] === '\n') {
        i++;
      }
      currentRow.push(currentField);
      currentField = '';
      rows.push(currentRow);
      currentRow = [];
      i++;
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentField);
      currentField = '';
      rows.push(currentRow);
      currentRow = [];
      i++;
      continue;
    }

    currentField += char;
    i++;
  }

  if (currentRow.length > 0 || currentField !== '') {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

export function parseWorkbookSheets(buffer: Uint8Array): SpreadsheetSheet[] {
  if (!buffer || buffer.length === 0) {
    throw new Error('Planilha vazia ou buffer inválido.');
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new Error('Falha ao processar planilha: formato inválido.');
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('Planilha vazia: nenhuma aba encontrada.');
  }

  const sheets: SpreadsheetSheet[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) {
      sheets.push({
        name: sheetName,
        columns: [],
        rows: [],
        totalRows: 0,
        truncated: false,
      });
      continue;
    }

    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
    });

    let maxCols = 0;
    try {
      const range = XLSX.utils.decode_range(sheet['!ref']);
      maxCols = range.e.c + 1;
    } catch {
      for (const row of rawRows) {
        if (Array.isArray(row) && row.length > maxCols) {
          maxCols = row.length;
        }
      }
    }

    maxCols = Math.min(maxCols, MAX_SHEET_COLS);
    const columns: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      columns.push(XLSX.utils.encode_col(c));
    }

    const stringRows: string[][] = rawRows.map((row) => {
      const cells: string[] = [];
      const rowArr = Array.isArray(row) ? row : [];
      for (let c = 0; c < maxCols; c++) {
        const val = c < rowArr.length ? rowArr[c] : '';
        cells.push(val === undefined || val === null ? '' : String(val));
      }
      return cells;
    });

    const totalRows = stringRows.length;
    const truncated = totalRows > MAX_SHEET_ROWS;
    const rows = truncated ? stringRows.slice(0, MAX_SHEET_ROWS) : stringRows;

    sheets.push({
      name: sheetName,
      columns,
      rows,
      totalRows,
      truncated,
    });
  }

  const hasContent = sheets.some((sheet) => sheet.totalRows > 0);
  if (!hasContent) {
    throw new Error('Planilha vazia: nenhuma linha encontrada.');
  }

  return sheets;
}

export function detectFileKind(input: { filePath: string; sample: Uint8Array }): FilePreviewKind {
  const ext = extname(input.filePath).toLowerCase();

  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') return 'markdown';
  if (
    ext === '.xls' ||
    ext === '.xlsx' ||
    ext === '.xlsm' ||
    ext === '.ods' ||
    ext === '.csv' ||
    ext === '.tsv'
  ) {
    return 'spreadsheet';
  }
  if (
    ext === '.png' ||
    ext === '.jpg' ||
    ext === '.jpeg' ||
    ext === '.gif' ||
    ext === '.webp' ||
    ext === '.svg' ||
    ext === '.ico' ||
    ext === '.bmp'
  ) {
    return 'image';
  }
  if (ext === '.pdf') return 'pdf';

  for (let i = 0; i < input.sample.length; i++) {
    if (input.sample[i] === 0) {
      return 'binary';
    }
  }

  return 'text';
}

export interface ReadFilePreviewContentInput {
  filePath: string;
  source: FilePreviewSource;
  cwd?: string;
  allowedRoots?: readonly string[];
  allowExternal?:
    | ReadonlySet<string>
    | readonly string[]
    | ((candidatePath: string) => boolean | Promise<boolean>);
  createPreviewUrl?: (input: { rootDir: string; filePath: string }) => Promise<string>;
}

export async function readFilePreviewContent(
  input: ReadFilePreviewContentInput,
): Promise<Result<FilePreview>> {
  let realTarget: string;
  let rootDir: string;

  if (input.source === 'project') {
    const targetPath = isAbsolute(input.filePath)
      ? input.filePath
      : resolve(input.cwd ?? '', input.filePath);

    try {
      realTarget = await realpath(targetPath);
    } catch {
      return fail('Arquivo não encontrado.');
    }

    const candidateRoots =
      input.allowedRoots && input.allowedRoots.length > 0
        ? input.allowedRoots
        : input.cwd
          ? [input.cwd]
          : [];

    let isAllowed = false;
    let matchedRoot: string | undefined;

    for (const root of candidateRoots) {
      try {
        const realRoot = await realpath(root);
        if (isInsideRoot(realRoot, realTarget)) {
          isAllowed = true;
          matchedRoot = realRoot;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!isAllowed) {
      return fail('Acesso negado: o arquivo está fora da pasta do projeto.');
    }

    rootDir = matchedRoot ?? dirname(realTarget);
  } else if (input.source === 'picker') {
    if (!isAbsolute(input.filePath)) {
      return fail('Caminho deve ser absoluto para seleção externa.');
    }

    try {
      realTarget = await realpath(input.filePath);
    } catch {
      return fail('Arquivo não encontrado.');
    }

    const permitted = await isExternalPermitted(input.filePath, realTarget, input.allowExternal);
    if (!permitted) {
      return fail('Arquivo não autorizado pelo seletor.');
    }

    rootDir = dirname(realTarget);
  } else {
    if (!isAbsolute(input.filePath)) {
      return fail('Caminho deve ser absoluto para arquivo solto.');
    }

    try {
      realTarget = await realpath(input.filePath);
    } catch {
      return fail('Arquivo não encontrado.');
    }

    rootDir = dirname(realTarget);
  }

  let fileStat;
  try {
    fileStat = await stat(realTarget);
  } catch {
    return fail('Arquivo não encontrado.');
  }

  if (!fileStat.isFile()) {
    return fail('O caminho informado não é um arquivo regular.');
  }

  const base = {
    resolvedPath: realTarget,
    name: basename(realTarget),
    extension: extname(realTarget).toLowerCase(),
    sizeBytes: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
  };

  const sample = await readSampleBytes(realTarget, SAMPLE_SIZE);
  const kind = detectFileKind({ filePath: realTarget, sample });

  if (kind === 'binary') {
    return ok({
      ...base,
      kind: 'binary',
      reason: 'Arquivo binário não suportado para visualização em texto.',
    });
  }

  if (kind === 'spreadsheet') {
    if (fileStat.size > MAX_SPREADSHEET_BYTES) {
      return ok({
        ...base,
        kind: 'too-large',
        reason: 'Planilha excede o limite de tamanho para visualização (20 MB).',
      });
    }

    if (base.extension === '.csv' || base.extension === '.tsv') {
      const fileBuffer = await readFile(realTarget);
      const text = fileBuffer.toString('utf-8');
      const delimiter = base.extension === '.tsv' ? '\t' : ',';
      const rawRows = parseCsvRows({ text, delimiter });

      let maxCols = 0;
      for (const row of rawRows) {
        if (row.length > maxCols) maxCols = row.length;
      }
      maxCols = Math.min(maxCols, MAX_SHEET_COLS);

      const columns: string[] = [];
      for (let c = 0; c < maxCols; c++) {
        columns.push(XLSX.utils.encode_col(c));
      }

      const stringRows: string[][] = rawRows.map((row) => {
        const cells: string[] = [];
        for (let c = 0; c < maxCols; c++) {
          cells.push(c < row.length ? (row[c] ?? '') : '');
        }
        return cells;
      });

      const totalRows = stringRows.length;
      const truncated = totalRows > MAX_SHEET_ROWS;
      const rows = truncated ? stringRows.slice(0, MAX_SHEET_ROWS) : stringRows;

      return ok({
        ...base,
        kind: 'spreadsheet',
        sheets: [
          {
            name: base.name,
            columns,
            rows,
            totalRows,
            truncated,
          },
        ],
      });
    }

    const fileBuffer = await readFile(realTarget);
    let sheets: SpreadsheetSheet[];
    try {
      sheets = parseWorkbookSheets(fileBuffer);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao processar planilha.';
      return fail(message);
    }

    return ok({
      ...base,
      kind: 'spreadsheet',
      sheets,
    });
  }

  if (kind === 'text' || kind === 'markdown' || kind === 'html') {
    if (fileStat.size > MAX_TEXT_BYTES) {
      return ok({
        ...base,
        kind: 'too-large',
        reason: 'Arquivo excede o tamanho limite para visualização (2 MB).',
      });
    }

    const fileBuffer = await readFile(realTarget);
    const content = fileBuffer.toString('utf-8');

    if (kind === 'text') {
      return ok({
        ...base,
        kind: 'text',
        content,
      });
    }

    if (kind === 'markdown') {
      return ok({
        ...base,
        kind: 'markdown',
        content,
      });
    }

    let previewUrl: string | undefined;
    if (input.createPreviewUrl) {
      previewUrl = await input.createPreviewUrl({ rootDir, filePath: realTarget });
    }

    return ok({
      ...base,
      kind: 'html',
      content,
      ...(previewUrl !== undefined ? { previewUrl } : {}),
    });
  }

  if (kind === 'image') {
    let previewUrl: string | undefined;
    if (input.createPreviewUrl) {
      previewUrl = await input.createPreviewUrl({ rootDir, filePath: realTarget });
    }

    let content: string | undefined;
    if (base.extension === '.svg' && fileStat.size <= MAX_TEXT_BYTES) {
      const fileBuffer = await readFile(realTarget);
      content = fileBuffer.toString('utf-8');
    }

    return ok({
      ...base,
      kind: 'image',
      ...(previewUrl !== undefined ? { previewUrl } : {}),
      ...(content !== undefined ? { content } : {}),
    });
  }

  let previewUrl: string | undefined;
  if (input.createPreviewUrl) {
    previewUrl = await input.createPreviewUrl({ rootDir, filePath: realTarget });
  }

  return ok({
    ...base,
    kind: 'pdf',
    ...(previewUrl !== undefined ? { previewUrl } : {}),
  });
}
