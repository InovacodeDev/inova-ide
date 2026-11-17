const KNOWN_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'html',
  'htm',
  'xhtml',
  'css',
  'scss',
  'sass',
  'less',
  'vue',
  'svelte',
  'astro',
  'json',
  'jsonc',
  'json5',
  'yaml',
  'yml',
  'toml',
  'xml',
  'csv',
  'tsv',
  'sql',
  'graphql',
  'gql',
  'prisma',
  'proto',
  'env',
  'ini',
  'conf',
  'config',
  'xls',
  'xlsx',
  'xlsm',
  'xlsb',
  'ods',
  'md',
  'markdown',
  'mdx',
  'txt',
  'rtf',
  'pdf',
  'log',
  'rst',
  'adoc',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'ico',
  'bmp',
  'tiff',
  'avif',
  'py',
  'pyi',
  'rs',
  'go',
  'java',
  'c',
  'cpp',
  'cc',
  'cxx',
  'h',
  'hpp',
  'hh',
  'cs',
  'php',
  'swift',
  'kt',
  'kts',
  'dart',
  'rb',
  'lua',
  'r',
  'scala',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'bat',
  'cmd',
  'wasm',
  'zip',
  'tar',
  'gz',
  'tgz',
  'rar',
  '7z',
]);

const KNOWN_FILENAMES = new Set([
  'dockerfile',
  'makefile',
  'containerfile',
  'gemfile',
  'procfile',
  'rakefile',
  'vagrantfile',
]);

// REGEX: detects URI schemes excluding single-letter Windows drive letters
const SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

// REGEX: matches Windows drive letters (e.g. C:/ or D:\)
const WINDOWS_DRIVE_REGEX = /^[a-zA-Z]:[\\/]/;

// REGEX: matches file:// protocol prefix with optional Windows drive triple-slash
const FILE_PROTOCOL_WINDOWS_REGEX = /^file:\/\/\/[a-zA-Z]:[\\/]/i;

// REGEX: matches line number in URL hash (e.g. #L12, #L12-L24, #12, #line-12)
const HASH_LINE_REGEX = /^(?:line[-_]?)?l?(\d+)/i;

// REGEX: matches trailing line or line:col suffix in path (e.g. :42 or :42:10)
const PATH_LINE_REGEX = /:(\d+)(?::\d+)?$/;

// REGEX: matches characters disallowed in local file paths or code calls
const INVALID_PATH_CHARS_REGEX = /[<>()"|?*]/;

// REGEX: matches numeric fractions or division (e.g. 1/2)
const FRACTION_REGEX = /^\d+\/\d+$/;

// REGEX: matches semver or release version strings (e.g. v0.9.2, 1.0.0, v1.0)
const VERSION_REGEX = /^v?\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.-]+)?$/;

// REGEX: matches common dotfile patterns (e.g. .gitignore, .editorconfig)
const DOTFILE_REGEX = /^\.[a-zA-Z0-9_-]+(?:rc|ignore|config)?$/;

// REGEX: extracts file extension from filename
const EXTENSION_REGEX = /\.([a-zA-Z0-9_-]+)$/;

export interface ParsedFileLink {
  readonly path: string;
  readonly line: number | null;
}

export function parseLocalFileHref(href: string): ParsedFileLink | null {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('//')) return null;

  if (SCHEME_REGEX.test(trimmed)) {
    if (trimmed.toLowerCase().startsWith('file:')) {
      // NOTE: file: URLs are treated as local files
    } else if (WINDOWS_DRIVE_REGEX.test(trimmed)) {
      // NOTE: Windows drive paths like C:/... match scheme regex but are local
    } else {
      return null;
    }
  }

  const hashIndex = trimmed.indexOf('#');
  const rawPath = hashIndex !== -1 ? trimmed.slice(0, hashIndex) : trimmed;
  const rawHash = hashIndex !== -1 ? trimmed.slice(hashIndex + 1) : '';

  if (rawPath.trim() === '') return null;

  let line: number | null = null;
  if (rawHash) {
    const hashMatch = HASH_LINE_REGEX.exec(rawHash);
    if (hashMatch?.[1]) {
      line = parseInt(hashMatch[1], 10);
    }
  }

  let normalizedPath = rawPath.trim();
  if (FILE_PROTOCOL_WINDOWS_REGEX.test(normalizedPath)) {
    normalizedPath = normalizedPath.slice('file:///'.length);
  } else if (normalizedPath.toLowerCase().startsWith('file://')) {
    normalizedPath = normalizedPath.slice('file://'.length);
  }

  try {
    normalizedPath = decodeURIComponent(normalizedPath);
  } catch {
    // NOTE: decodeURIComponent throws on invalid percent sequences; fall back to raw
  }

  if (line === null) {
    const pathLineMatch = PATH_LINE_REGEX.exec(normalizedPath);
    if (pathLineMatch?.[1]) {
      line = parseInt(pathLineMatch[1], 10);
      normalizedPath = normalizedPath.slice(0, pathLineMatch.index);
    }
  }

  const finalPath = normalizedPath.trim();
  if (finalPath === '') return null;

  return { path: finalPath, line };
}

export function parseInlineFileCode(text: string): ParsedFileLink | null {
  let candidate = text.trim();
  if (candidate === '' || /\s/.test(candidate)) return null;

  if (candidate.startsWith('`') && candidate.endsWith('`') && candidate.length > 1) {
    candidate = candidate.slice(1, -1).trim();
  } else if (candidate.startsWith('"') && candidate.endsWith('"') && candidate.length > 1) {
    candidate = candidate.slice(1, -1).trim();
  } else if (candidate.startsWith("'") && candidate.endsWith("'") && candidate.length > 1) {
    candidate = candidate.slice(1, -1).trim();
  }

  if (candidate === '' || candidate.startsWith('//')) return null;

  if (SCHEME_REGEX.test(candidate)) {
    if (candidate.toLowerCase().startsWith('file:')) {
      // NOTE: file: URLs are treated as local files
    } else if (WINDOWS_DRIVE_REGEX.test(candidate)) {
      // NOTE: Windows drive paths are local
    } else {
      return null;
    }
  }

  if (FILE_PROTOCOL_WINDOWS_REGEX.test(candidate)) {
    candidate = candidate.slice('file:///'.length);
  } else if (candidate.toLowerCase().startsWith('file://')) {
    candidate = candidate.slice('file://'.length);
  }

  let line: number | null = null;
  const hashIndex = candidate.indexOf('#');
  if (hashIndex !== -1) {
    const hash = candidate.slice(hashIndex + 1);
    candidate = candidate.slice(0, hashIndex);
    const hashMatch = HASH_LINE_REGEX.exec(hash);
    if (hashMatch?.[1]) {
      line = parseInt(hashMatch[1], 10);
    }
  }

  if (line === null) {
    const lineMatch = PATH_LINE_REGEX.exec(candidate);
    if (lineMatch?.[1]) {
      line = parseInt(lineMatch[1], 10);
      candidate = candidate.slice(0, lineMatch.index);
    }
  }

  if (INVALID_PATH_CHARS_REGEX.test(candidate)) return null;
  if (FRACTION_REGEX.test(candidate)) return null;
  if (VERSION_REGEX.test(candidate)) return null;

  // REGEX: strips trailing punctuation left from markdown prose
  candidate = candidate.replace(/[.,;:]$/, '');
  if (candidate === '') return null;

  const basename = candidate.split(/[/\\]/).filter(Boolean).pop() ?? '';
  if (basename === '') return null;

  if (KNOWN_FILENAMES.has(basename.toLowerCase())) {
    return { path: candidate, line };
  }

  if (DOTFILE_REGEX.test(basename)) {
    return { path: candidate, line };
  }

  const extMatch = EXTENSION_REGEX.exec(basename);
  const ext = extMatch?.[1]?.toLowerCase();
  if (ext && KNOWN_EXTENSIONS.has(ext)) {
    return { path: candidate, line };
  }

  const hasSlash = candidate.includes('/') || candidate.includes('\\');
  if (hasSlash) {
    const segments = candidate.split(/[/\\]/).filter(Boolean);
    if (segments.length >= 2) {
      return { path: candidate, line };
    }
  }

  return null;
}
