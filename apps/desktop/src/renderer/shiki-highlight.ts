import { createHighlighterCore, type HighlighterCore, type LanguageInput } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const CACHE_LIMIT = 200;

const LANG_LOADERS: Record<string, () => LanguageInput> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  prisma: () => import('shiki/langs/prisma.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  csv: () => import('shiki/langs/csv.mjs'),
  tsv: () => import('shiki/langs/tsv.mjs'),
};

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  bash: 'shellscript',
  sh: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  py: 'python',
  rs: 'rust',
  kt: 'kotlin',
  'c++': 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  yml: 'yaml',
  md: 'markdown',
  rb: 'ruby',
  docker: 'dockerfile',
  htm: 'html',
  gql: 'graphql',
  svg: 'xml',
  patch: 'diff',
};

const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  go: 'go',
  dart: 'dart',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  json: 'json',
  jsonc: 'jsonc',
  sql: 'sql',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'dockerfile',
  rb: 'ruby',
  php: 'php',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',
  ini: 'ini',
  csv: 'csv',
  tsv: 'tsv',
};

const KNOWN_FILENAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'shellscript',
  containerfile: 'dockerfile',
};

export function canonicalLang(lang: string): string | null {
  const key = lang.toLowerCase();
  const name = LANG_ALIASES[key] ?? key;
  return name in LANG_LOADERS ? name : null;
}

export function languageForFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const basename = normalized.split('/').pop()?.toLowerCase() ?? '';
  if (basename === '') return 'text';
  if (basename in KNOWN_FILENAMES) {
    return KNOWN_FILENAMES[basename] ?? 'text';
  }
  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === 0) {
    return 'text';
  }
  const ext = basename.slice(dotIndex + 1);
  return EXTENSION_MAP[ext] ?? 'text';
}

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [
      import('shiki/themes/catppuccin-mocha.mjs'),
      import('shiki/themes/catppuccin-latte.mjs'),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

const htmlCache = new Map<string, string>();

export interface HighlightCodeInput {
  code: string;
  lang: string;
}

export async function highlightCode(input: HighlightCodeInput): Promise<string | null> {
  const name = canonicalLang(input.lang);
  if (name === null) return null;
  const key = `${name}\u0000${input.code}`;
  const cached = htmlCache.get(key);
  if (cached !== undefined) return cached;
  const highlighter = await getHighlighter();
  const loader = LANG_LOADERS[name];
  if (loader === undefined) return null;
  await highlighter.loadLanguage(loader());
  const html = highlighter.codeToHtml(input.code, {
    lang: name,
    themes: { dark: 'catppuccin-mocha', light: 'catppuccin-latte' },
    defaultColor: false,
  });
  if (htmlCache.size >= CACHE_LIMIT) {
    const oldest = htmlCache.keys().next();
    if (!oldest.done) htmlCache.delete(oldest.value);
  }
  htmlCache.set(key, html);
  return html;
}
