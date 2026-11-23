import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { SKILL_MARKER_FILE } from './skills.js';

export const MAX_ZIP_BYTES = 15 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 300;
export const MAX_ZIP_ENTRY_BYTES = 2 * 1024 * 1024;
export const MAX_ZIP_TOTAL_BYTES = 10 * 1024 * 1024;
export const MAX_ZIP_DEPTH = 8;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MIN_BYTES = 22;
const EOCD_MAX_COMMENT = 0xffff;
const CENTRAL_HEADER_FIXED_BYTES = 46;
const LOCAL_HEADER_FIXED_BYTES = 30;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;
const UNIX_HOST_OS = 3;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_SYMLINK_TYPE = 0o120000;
const UNIX_OWNER_EXECUTE = 0o100;
const ZIP64_COUNT_SENTINEL = 0xffff;
const ZIP64_OFFSET_SENTINEL = 0xffffffff;

// REGEX: Windows drive prefix like C:
const DRIVE_PREFIX = /^[A-Za-z]:/;
// REGEX: environment file name (.env or .env.*) except *.example
const REAL_ENV_NAME = /^\.env(?:\..+)?$/i;
const EXAMPLE_ENV_NAME = /\.example$/i;

const RESERVED_ROOT_FOLDERS: ReadonlySet<string> = new Set([
  'skills',
  'commands',
  '.claude-plugin',
  '.codex-plugin',
  '.cursor-plugin',
  '.antigravity-plugin',
  'assets',
  'scripts',
  'hooks',
]);

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipFileEntry {
  path: string;
  data: Buffer;
  executable: boolean;
}

function findEocdOffset(buffer: Buffer): number {
  if (buffer.length < EOCD_MIN_BYTES) {
    throw new ZipError('Arquivo ZIP inválido ou truncado.');
  }
  const minOffset = Math.max(0, buffer.length - EOCD_MIN_BYTES - EOCD_MAX_COMMENT);
  for (let offset = buffer.length - EOCD_MIN_BYTES; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + EOCD_MIN_BYTES + commentLength === buffer.length) return offset;
  }
  throw new ZipError('Assinatura ZIP não encontrada.');
}

function isNoiseSegment(segment: string): boolean {
  return (
    segment === '__MACOSX' ||
    segment === '.DS_Store' ||
    segment === '.git' ||
    segment === 'node_modules' ||
    segment === SKILL_MARKER_FILE
  );
}

function normalizeEntryPath(rawName: string): { path: string; isDir: boolean; ignored: boolean } {
  if (rawName.includes('\0')) throw new ZipError('Entrada ZIP contém byte nulo.');
  const slashNormalized = rawName.replaceAll('\\', '/');
  const isDir = slashNormalized.endsWith('/');
  const trimmed = isDir ? slashNormalized.slice(0, -1) : slashNormalized;
  if (trimmed === '') return { path: '', isDir: true, ignored: true };
  if (trimmed.startsWith('/') || DRIVE_PREFIX.test(trimmed)) {
    throw new ZipError(`Caminho absoluto não permitido no ZIP: ${rawName}`);
  }
  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new ZipError(`Caminho inválido no ZIP: ${rawName}`);
    }
  }
  if (segments.some(isNoiseSegment)) {
    return { path: trimmed, isDir, ignored: true };
  }
  const depth = isDir ? segments.length : segments.length - 1;
  if (depth > MAX_ZIP_DEPTH) {
    throw new ZipError(`Profundidade de pastas excede ${MAX_ZIP_DEPTH} níveis.`);
  }
  const fileName = segments[segments.length - 1] ?? '';
  if (!isDir && REAL_ENV_NAME.test(fileName) && !EXAMPLE_ENV_NAME.test(fileName)) {
    throw new ZipError(`Arquivo de ambiente recusado no ZIP: ${trimmed}`);
  }
  return { path: trimmed, isDir, ignored: false };
}

function decompressEntryData(input: {
  buffer: Buffer;
  localOffset: number;
  cdOffset: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  entryPath: string;
}): Buffer {
  const { buffer, localOffset, cdOffset, method, compressedSize, uncompressedSize, entryPath } =
    input;
  if (localOffset + LOCAL_HEADER_FIXED_BYTES > cdOffset) {
    throw new ZipError(`Cabeçalho local truncado para ${entryPath}.`);
  }
  if (buffer.readUInt32LE(localOffset) !== LOCAL_HEADER_SIGNATURE) {
    throw new ZipError(`Cabeçalho local inválido para ${entryPath}.`);
  }
  const localNameLen = buffer.readUInt16LE(localOffset + 26);
  const localExtraLen = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + LOCAL_HEADER_FIXED_BYTES + localNameLen + localExtraLen;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > cdOffset) {
    throw new ZipError(`Dados compactados truncados para ${entryPath}.`);
  }
  const slice = buffer.subarray(dataStart, dataEnd);
  let data: Buffer;
  if (method === METHOD_STORE) {
    data = Buffer.from(slice);
  } else if (method === METHOD_DEFLATE) {
    try {
      data = inflateRawSync(slice, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
    } catch {
      throw new ZipError(`Falha ao descompactar ${entryPath}.`);
    }
  } else {
    throw new ZipError(`Método de compressão ZIP não suportado (${method}) em ${entryPath}.`);
  }
  if (data.length !== uncompressedSize) {
    throw new ZipError(`Tamanho descompactado inconsistente em ${entryPath}.`);
  }
  return data;
}

export function extractZipEntries(buffer: Buffer): ZipFileEntry[] {
  if (buffer.length > MAX_ZIP_BYTES) {
    throw new ZipError(`O arquivo ZIP excede o limite de ${MAX_ZIP_BYTES} bytes.`);
  }
  const eocdOffset = findEocdOffset(buffer);
  const disk = buffer.readUInt16LE(eocdOffset + 4);
  const cdDisk = buffer.readUInt16LE(eocdOffset + 6);
  const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (
    totalEntries === ZIP64_COUNT_SENTINEL ||
    cdSize === ZIP64_OFFSET_SENTINEL ||
    cdOffset === ZIP64_OFFSET_SENTINEL
  ) {
    throw new ZipError('Arquivos Zip64 não são suportados.');
  }
  if (disk !== 0 || cdDisk !== 0 || diskEntries !== totalEntries) {
    throw new ZipError('Arquivos ZIP divididos em múltiplos volumes não são suportados.');
  }
  if (cdOffset + cdSize > eocdOffset) {
    throw new ZipError('Diretório central do ZIP fora dos limites do arquivo.');
  }

  const entries: ZipFileEntry[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;
  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;

  for (let index = 0; index < totalEntries; index += 1) {
    if (pos + CENTRAL_HEADER_FIXED_BYTES > cdEnd) {
      throw new ZipError('Entrada do diretório central ZIP truncada.');
    }
    if (buffer.readUInt32LE(pos) !== CENTRAL_HEADER_SIGNATURE) {
      throw new ZipError('Assinatura inválida no diretório central ZIP.');
    }
    const versionMadeBy = buffer.readUInt16LE(pos + 4);
    const flags = buffer.readUInt16LE(pos + 8);
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const externalAttrs = buffer.readUInt32LE(pos + 38);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const nextPos = pos + CENTRAL_HEADER_FIXED_BYTES + nameLen + extraLen + commentLen;
    if (nextPos > cdEnd) {
      throw new ZipError('Nome ou metadados do ZIP fora dos limites.');
    }
    const rawName = buffer
      .subarray(pos + CENTRAL_HEADER_FIXED_BYTES, pos + CENTRAL_HEADER_FIXED_BYTES + nameLen)
      .toString('utf8');
    pos = nextPos;

    const normalized = normalizeEntryPath(rawName);
    if (normalized.ignored) continue;
    if ((flags & FLAG_ENCRYPTED) !== 0) {
      throw new ZipError(`Arquivos ZIP criptografados não são suportados (${normalized.path}).`);
    }
    const hostOs = versionMadeBy >>> 8;
    const unixMode = (externalAttrs >>> 16) & 0xffff;
    if (hostOs === UNIX_HOST_OS && (unixMode & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK_TYPE) {
      throw new ZipError(`Links simbólicos não são permitidos no ZIP: ${normalized.path}`);
    }
    if (normalized.isDir) continue;
    if (entries.length + 1 > MAX_ZIP_ENTRIES) {
      throw new ZipError(`O ZIP excede o limite de ${MAX_ZIP_ENTRIES} arquivos.`);
    }
    const lowerPath = normalized.path.toLowerCase();
    if (seenPaths.has(lowerPath)) {
      throw new ZipError(`Entrada duplicada no ZIP: ${normalized.path}`);
    }
    seenPaths.add(lowerPath);
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
      throw new ZipError(`Arquivo ${normalized.path} excede ${MAX_ZIP_ENTRY_BYTES} bytes.`);
    }
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new ZipError(`Conteúdo extraído excede ${MAX_ZIP_TOTAL_BYTES} bytes.`);
    }

    const data = decompressEntryData({
      buffer,
      localOffset,
      cdOffset,
      method,
      compressedSize,
      uncompressedSize,
      entryPath: normalized.path,
    });
    const executable = hostOs === UNIX_HOST_OS && (unixMode & UNIX_OWNER_EXECUTE) !== 0;
    entries.push({ path: normalized.path, data, executable });
  }

  return entries;
}

export function stripCommonZipRoot(entries: readonly ZipFileEntry[]): ZipFileEntry[] {
  if (entries.length === 0) return [];
  const firstSlash = entries[0]!.path.indexOf('/');
  if (firstSlash <= 0) return [...entries];
  const rootSegment = entries[0]!.path.slice(0, firstSlash);
  if (RESERVED_ROOT_FOLDERS.has(rootSegment)) return [...entries];
  const prefix = `${rootSegment}/`;
  if (!entries.every((entry) => entry.path.startsWith(prefix))) return [...entries];
  return entries.map((entry) => ({
    ...entry,
    path: entry.path.slice(prefix.length),
  }));
}

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = buildCrc32Table();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZipBuffer(
  entries: readonly { path: string; data: Buffer | string; executable?: boolean }[],
): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const rawData = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const compressed = deflateRawSync(rawData);
    const nameBuf = Buffer.from(entry.path, 'utf8');
    const checksum = crc32(rawData);
    const mode = entry.executable ? 0o100755 : 0o100644;

    const local = Buffer.alloc(LOCAL_HEADER_FIXED_BYTES);
    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(rawData.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    const central = Buffer.alloc(CENTRAL_HEADER_FIXED_BYTES);
    central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    central.writeUInt16LE((UNIX_HOST_OS << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(rawData.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);

    localChunks.push(local, nameBuf, compressed);
    centralChunks.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(EOCD_MIN_BYTES);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, centralDir, eocd]);
}
