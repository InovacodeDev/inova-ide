import { isValidElement, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckIcon, CopyIcon } from './icons';
import { parseInlineFileCode, parseLocalFileHref } from './markdown-file-links';
import { highlightCode } from './shiki-highlight';

const LANG_CLASS = /language-([\w+#-]+)/;

interface CodeBlockProps {
  lang: string;
  code: string;
  streaming: boolean;
}

function CodeBlock({ lang, code, streaming }: CodeBlockProps) {
  const [highlighted, setHighlighted] = useState<{ key: string; html: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const key = `${lang}\u0000${code}`;

  useEffect(() => {
    if (streaming) return;
    let cancelled = false;
    highlightCode({ code, lang })
      .then((html) => {
        if (!cancelled && html !== null) setHighlighted({ key, html });
      })
      .catch((error: unknown) => {
        console.error('inova: syntax highlighting failed', error);
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang, key, streaming]);

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

  const html = !streaming && highlighted?.key === key ? highlighted.html : null;

  return (
    <div className="md-code">
      <div className="md-code-header">
        <span className="md-code-lang">{lang === '' ? 'texto' : lang}</span>
        <button
          type="button"
          className="md-code-copy"
          aria-label={copied ? 'Copiado' : 'Copiar'}
          data-tooltip={copied ? 'Copiado' : 'Copiar código'}
          onClick={copy}
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
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

interface CodeElementProps {
  className?: string;
  children?: ReactNode;
}

function blockFromPre(children: ReactNode): { lang: string; code: string } {
  const element = Array.isArray(children) ? children[0] : children;
  const props: CodeElementProps = isValidElement<CodeElementProps>(element) ? element.props : {};
  const match = LANG_CLASS.exec(props.className ?? '');
  return { lang: match?.[1] ?? '', code: textOf(props.children).replace(/\n$/, '') };
}

function buildComponents(streaming: boolean, onOpenFile?: (path: string) => void): Components {
  return {
    a: ({ node: _node, href, onClick, children, ...props }) => {
      const local = typeof href === 'string' ? parseLocalFileHref(href) : null;
      if (local !== null && onOpenFile !== undefined) {
        return (
          <a
            {...props}
            href={href}
            className="md-file-link"
            onClick={(event) => {
              event.preventDefault();
              onClick?.(event);
              onOpenFile(local.path);
            }}
          >
            {children}
          </a>
        );
      }
      return (
        <a {...props} href={href} onClick={onClick} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
    table: ({ node: _node, ...props }) => (
      <div className="md-table-wrap">
        <table {...props} />
      </div>
    ),
    pre: ({ children }) => {
      const { lang, code } = blockFromPre(children);
      return <CodeBlock lang={lang} code={code} streaming={streaming} />;
    },
    code: ({ node: _node, className, children, ...props }) => {
      const codeText = textOf(children);
      const isBlock = Boolean(className && LANG_CLASS.test(className));
      const parsed = !isBlock && onOpenFile !== undefined ? parseInlineFileCode(codeText) : null;
      if (parsed !== null && onOpenFile !== undefined) {
        return (
          <code
            className={`${className ?? 'md-inline-code'} md-file-link`}
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenFile(parsed.path);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onOpenFile(parsed.path);
              }
            }}
            {...props}
          >
            {children}
          </code>
        );
      }
      return (
        <code className={className ?? 'md-inline-code'} {...props}>
          {children}
        </code>
      );
    },
  };
}

const remarkPlugins = [remarkGfm];

export interface MarkdownProps {
  text: string;
  streaming?: boolean;
  onOpenFile?: (path: string) => void;
}

function MarkdownImpl({ text, streaming = false, onOpenFile }: MarkdownProps) {
  const components = useMemo(() => buildComponents(streaming, onOpenFile), [streaming, onOpenFile]);

  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
