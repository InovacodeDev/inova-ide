import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface PreviewRegistry {
  authorizeRoot(dirPath: string): Promise<string>;
  buildUrl(input: { rootDir: string; filePath: string }): Promise<string>;
  resolveRequest(url: string): Promise<{ filePath: string; mimeType: string } | null>;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.mdx': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

export function lookupMimeType(extension: string): string {
  return MIME_TYPES[extension.toLowerCase()] ?? 'application/octet-stream';
}

export function isInsideRoot(rootReal: string, targetReal: string): boolean {
  return (
    targetReal === rootReal ||
    targetReal.startsWith(rootReal.endsWith(sep) ? rootReal : rootReal + sep)
  );
}

export function createPreviewRegistry(deps?: { generateToken?: () => string }): PreviewRegistry {
  const generateToken = deps?.generateToken ?? (() => randomUUID());
  const rootToToken = new Map<string, string>();
  const tokenToRoot = new Map<string, string>();

  async function authorizeRoot(dirPath: string): Promise<string> {
    const canonical = await realpath(dirPath);
    const existing = rootToToken.get(canonical);
    if (existing !== undefined) return existing;
    const token = generateToken();
    rootToToken.set(canonical, token);
    tokenToRoot.set(token, canonical);
    return token;
  }

  async function buildUrl(input: { rootDir: string; filePath: string }): Promise<string> {
    const canonicalRoot = await realpath(input.rootDir);
    const token = await authorizeRoot(canonicalRoot);
    const resolvedTarget = isAbsolute(input.filePath)
      ? input.filePath
      : resolve(canonicalRoot, input.filePath);
    const relPath = relative(canonicalRoot, resolvedTarget);
    const relPosix = relPath.split(sep).join('/');
    if (relPosix.startsWith('..') || isAbsolute(relPosix)) {
      throw new Error('O arquivo está fora do diretório raiz autorizado.');
    }
    const encodedSegments = relPosix
      .split('/')
      .filter((segment) => segment.length > 0)
      .map(encodeURIComponent)
      .join('/');
    return `inova-preview://view/${token}/${encodedSegments}`;
  }

  async function resolveRequest(
    url: string,
  ): Promise<{ filePath: string; mimeType: string } | null> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return null;
    }

    if (parsedUrl.protocol !== 'inova-preview:') return null;
    if (parsedUrl.hostname !== 'view' && parsedUrl.host !== 'view') return null;

    const rawPath = parsedUrl.pathname.startsWith('/')
      ? parsedUrl.pathname.slice(1)
      : parsedUrl.pathname;
    const slashIndex = rawPath.indexOf('/');
    const token = slashIndex === -1 ? rawPath : rawPath.slice(0, slashIndex);
    const relativeEncoded = slashIndex === -1 ? '' : rawPath.slice(slashIndex + 1);

    if (!token) return null;
    const canonicalRoot = tokenToRoot.get(token);
    if (canonicalRoot === undefined) return null;

    let decodedRelative: string;
    try {
      decodedRelative = decodeURIComponent(relativeEncoded);
    } catch {
      return null;
    }

    if (decodedRelative.includes('\0')) return null;

    const candidatePath = resolve(canonicalRoot, decodedRelative);

    let realCandidate: string;
    try {
      realCandidate = await realpath(candidatePath);
    } catch {
      return null;
    }

    if (!isInsideRoot(canonicalRoot, realCandidate)) {
      return null;
    }

    try {
      const fileStat = await stat(realCandidate);
      if (!fileStat.isFile()) return null;
    } catch {
      return null;
    }

    const ext = extname(realCandidate).toLowerCase();
    const mimeType = lookupMimeType(ext);

    return { filePath: realCandidate, mimeType };
  }

  return {
    authorizeRoot,
    buildUrl,
    resolveRequest,
  };
}
