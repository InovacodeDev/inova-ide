import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createHighlighterCore, type HighlighterCore, type LanguageInput } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const LANG_CLASS = /language-([\w+#-]+)/;
const CACHE_LIMIT = 100;

const LANG_LOADERS: Record<string, () => LanguageInput> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
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
};

function canonicalLang(lang: string): string | null {
  const key = lang.toLowerCase();
  const name = LANG_ALIASES[key] ?? key;
  return name in LANG_LOADERS ? name : null;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import('shiki/themes/catppuccin-mocha.mjs')],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

const htmlCache = new Map<string, string>();

async function highlight(input: { code: string; lang: string }): Promise<string | null> {
  const name = canonicalLang(input.lang);
  if (name === null) return null;
  const key = `${name}\u0000${input.code}`;
  const cached = htmlCache.get(key);
  if (cached !== undefined) return cached;
  const highlighter = await getHighlighter();
  const loader = LANG_LOADERS[name];
  if (loader === undefined) return null;
  await highlighter.loadLanguage(loader());
  const html = highlighter.codeToHtml(input.code, { lang: name, theme: 'catppuccin-mocha' });
  if (htmlCache.size >= CACHE_LIMIT) {
    const oldest = htmlCache.keys().next();
    if (!oldest.done) htmlCache.delete(oldest.value);
  }
  htmlCache.set(key, html);
  return html;
}

interface CodeBlockProps {
  lang: string;
  code: string;
}

function CodeBlock({ lang, code }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    highlight({ code, lang })
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch((error: unknown) => {
        console.error('inova: syntax highlighting failed', error);
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  };

  return (
    <div className="md-code">
      <div className="md-code-header">
        <span className="md-code-lang">{lang === '' ? 'texto' : lang}</span>
        <button type="button" className="md-code-copy" onClick={copy}>
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      {html === null ? (
        <pre className="md-code-plain">
          <code>{code}</code>
        </pre>
      ) : (
        <div className="md-code-body" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

function textOf(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(textOf).join('');
  return '';
}

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  table: ({ node: _node, ...props }) => (
    <div className="md-table-wrap">
      <table {...props} />
    </div>
  ),
  pre: ({ children }) => <>{children}</>,
  code: ({ node: _node, className, children, ...props }) => {
    const match = LANG_CLASS.exec(className ?? '');
    const text = textOf(children);
    if (match === null && !text.includes('\n')) {
      return (
        <code className="md-inline-code" {...props}>
          {children}
        </code>
      );
    }
    return <CodeBlock lang={match?.[1] ?? ''} code={text.replace(/\n$/, '')} />;
  },
};

const remarkPlugins = [remarkGfm];

function MarkdownImpl({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
