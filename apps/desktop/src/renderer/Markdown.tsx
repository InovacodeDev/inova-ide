import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createHighlighter, type Highlighter } from 'shiki';

const THEME = 'catppuccin-mocha';
const LANG_CLASS = /language-([\w+#-]+)/;

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({ themes: [THEME], langs: [] });
  return highlighterPromise;
}

async function highlight(code: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter();
  let resolved = 'text';
  if (lang !== '' && lang !== 'text') {
    try {
      await highlighter.loadLanguage(lang as Parameters<Highlighter['loadLanguage']>[0]);
      resolved = lang;
    } catch {
      resolved = 'text';
    }
  }
  return highlighter.codeToHtml(code, { lang: resolved, theme: THEME });
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
    highlight(code, lang)
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
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
