import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { ComposerFormat } from './composer-format';
import {
  BoldIcon,
  ChevronDownIcon,
  CodeBlockIcon,
  DividerIcon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  ListBulletIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from './icons';
import { formatShortcut, type ShortcutId } from './shortcuts';

interface ToolbarAction {
  format: ComposerFormat;
  label: string;
  shortcutId?: ShortcutId;
  icon: ReactNode;
}

const INLINE_ACTIONS: readonly ToolbarAction[] = [
  { format: 'bold', label: 'Negrito', shortcutId: 'format-bold', icon: <BoldIcon /> },
  { format: 'italic', label: 'Itálico', shortcutId: 'format-italic', icon: <ItalicIcon /> },
  {
    format: 'underline',
    label: 'Sublinhado',
    shortcutId: 'format-underline',
    icon: <UnderlineIcon />,
  },
  {
    format: 'strike',
    label: 'Tachado',
    shortcutId: 'format-strike',
    icon: <StrikethroughIcon />,
  },
];

const LIST_ACTIONS: readonly ToolbarAction[] = [
  { format: 'link', label: 'Link', shortcutId: 'format-link', icon: <LinkIcon /> },
  { format: 'ordered', label: 'Lista numerada', icon: <ListOrderedIcon /> },
  { format: 'bullet', label: 'Lista com marcadores', icon: <ListBulletIcon /> },
];

const BLOCK_ACTIONS: readonly ToolbarAction[] = [
  { format: 'quote', label: 'Citação', icon: <QuoteIcon /> },
  {
    format: 'code',
    label: 'Código inline',
    shortcutId: 'format-code',
    icon: <InlineCodeIcon />,
  },
  { format: 'codeblock', label: 'Bloco de código', icon: <CodeBlockIcon /> },
  { format: 'divider', label: 'Divisor', icon: <DividerIcon /> },
];

const PARAGRAPH_OPTIONS: readonly { format: ComposerFormat; label: string }[] = [
  { format: 'paragraph', label: 'Texto normal' },
  { format: 'heading1', label: 'Título 1' },
  { format: 'heading2', label: 'Título 2' },
  { format: 'heading3', label: 'Título 3' },
];

export interface ComposerToolbarProps {
  isMac: boolean;
  active: ReadonlySet<ComposerFormat>;
  onFormat: (format: ComposerFormat) => void;
}

const keepSelection = (event: MouseEvent) => event.preventDefault();

function ToolbarGroup({
  actions,
  isMac,
  active,
  onFormat,
}: ComposerToolbarProps & { actions: readonly ToolbarAction[] }) {
  return (
    <>
      {actions.map((action) => {
        const shortcut =
          action.shortcutId === undefined ? '' : formatShortcut({ id: action.shortcutId, isMac });
        const title = shortcut === '' ? action.label : `${action.label} (${shortcut})`;
        return (
          <button
            key={action.format}
            type="button"
            className="chat-format-btn"
            aria-label={title}
            aria-pressed={active.has(action.format)}
            title={title}
            onMouseDown={keepSelection}
            onClick={() => onFormat(action.format)}
          >
            {action.icon}
          </button>
        );
      })}
    </>
  );
}

function ParagraphMenu({ active, onFormat }: Pick<ComposerToolbarProps, 'active' | 'onFormat'>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const node = containerRef.current;
      if (node !== null && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="chat-format-menu" ref={containerRef}>
      <button
        type="button"
        className="chat-format-btn chat-format-btn-wide"
        aria-pressed={PARAGRAPH_OPTIONS.some((option) => active.has(option.format))}
        aria-label="Estilo do parágrafo"
        title="Estilo do parágrafo"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={keepSelection}
        onClick={() => setOpen((current) => !current)}
      >
        <PilcrowIcon />
        <ChevronDownIcon size={10} />
      </button>
      {open ? (
        <div className="chat-format-popover" role="menu">
          {PARAGRAPH_OPTIONS.map((option) => (
            <button
              key={option.format}
              type="button"
              role="menuitem"
              aria-current={active.has(option.format) ? 'true' : undefined}
              className="chat-format-item"
              onMouseDown={keepSelection}
              onClick={() => {
                onFormat(option.format);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ComposerToolbar({ isMac, active, onFormat }: ComposerToolbarProps) {
  return (
    <div className="chat-format-toolbar" role="toolbar" aria-label="Formatação da mensagem">
      <ToolbarGroup actions={INLINE_ACTIONS} isMac={isMac} active={active} onFormat={onFormat} />
      <ParagraphMenu active={active} onFormat={onFormat} />
      <span className="chat-format-sep" aria-hidden="true" />
      <ToolbarGroup actions={LIST_ACTIONS} isMac={isMac} active={active} onFormat={onFormat} />
      <span className="chat-format-sep" aria-hidden="true" />
      <ToolbarGroup actions={BLOCK_ACTIONS} isMac={isMac} active={active} onFormat={onFormat} />
    </div>
  );
}
