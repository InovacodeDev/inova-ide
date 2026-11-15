import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { ComposerFormat } from './composer-format';
import type { TranslationKey } from './i18n';
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
import { useI18n } from './I18nContext';
import type { ShortcutId } from './shortcuts';

interface ToolbarAction {
  format: ComposerFormat;
  labelKey: TranslationKey;
  shortcutId?: ShortcutId;
  icon: ReactNode;
}

const INLINE_ACTIONS: readonly ToolbarAction[] = [
  {
    format: 'bold',
    labelKey: 'composer.format.bold',
    shortcutId: 'format-bold',
    icon: <BoldIcon />,
  },
  {
    format: 'italic',
    labelKey: 'composer.format.italic',
    shortcutId: 'format-italic',
    icon: <ItalicIcon />,
  },
  {
    format: 'underline',
    labelKey: 'composer.format.underline',
    shortcutId: 'format-underline',
    icon: <UnderlineIcon />,
  },
  {
    format: 'strike',
    labelKey: 'composer.format.strike',
    shortcutId: 'format-strike',
    icon: <StrikethroughIcon />,
  },
];

const LIST_ACTIONS: readonly ToolbarAction[] = [
  {
    format: 'link',
    labelKey: 'composer.format.linkShort',
    shortcutId: 'format-link',
    icon: <LinkIcon />,
  },
  { format: 'ordered', labelKey: 'composer.format.ol', icon: <ListOrderedIcon /> },
  { format: 'bullet', labelKey: 'composer.format.ul', icon: <ListBulletIcon /> },
];

const BLOCK_ACTIONS: readonly ToolbarAction[] = [
  { format: 'quote', labelKey: 'composer.format.blockquote', icon: <QuoteIcon /> },
  {
    format: 'code',
    labelKey: 'composer.format.code',
    shortcutId: 'format-code',
    icon: <InlineCodeIcon />,
  },
  { format: 'codeblock', labelKey: 'composer.format.codeBlock', icon: <CodeBlockIcon /> },
  { format: 'divider', labelKey: 'composer.format.divider', icon: <DividerIcon /> },
];

const PARAGRAPH_OPTIONS: readonly { format: ComposerFormat; labelKey: TranslationKey }[] = [
  { format: 'paragraph', labelKey: 'composer.format.normalText' },
  { format: 'heading1', labelKey: 'composer.format.heading1' },
  { format: 'heading2', labelKey: 'composer.format.heading2' },
  { format: 'heading3', labelKey: 'composer.format.heading3' },
];

export interface ComposerToolbarProps {
  active: ReadonlySet<ComposerFormat>;
  onFormat: (format: ComposerFormat) => void;
}

const keepSelection = (event: MouseEvent) => event.preventDefault();

function ToolbarGroup({
  actions,
  active,
  onFormat,
}: ComposerToolbarProps & { actions: readonly ToolbarAction[] }) {
  const { t } = useI18n();
  return (
    <>
      {actions.map((action) => {
        const label = t(action.labelKey);
        return (
          <button
            key={action.format}
            type="button"
            className="chat-format-btn"
            aria-label={label}
            aria-pressed={active.has(action.format)}
            data-tooltip={label}
            data-shortcut={action.shortcutId}
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
  const { t } = useI18n();
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

  const menuLabel = t('composer.format.paragraphMenu');
  return (
    <div className="chat-format-menu" ref={containerRef}>
      <button
        type="button"
        className="chat-format-btn chat-format-btn-wide"
        aria-pressed={PARAGRAPH_OPTIONS.some((option) => active.has(option.format))}
        aria-label={menuLabel}
        data-tooltip={menuLabel}
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
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ComposerToolbar({ active, onFormat }: ComposerToolbarProps) {
  const { t } = useI18n();
  return (
    <div className="chat-format-toolbar" role="toolbar" aria-label={t('composer.toolbarAria')}>
      <ToolbarGroup actions={INLINE_ACTIONS} active={active} onFormat={onFormat} />
      <ParagraphMenu active={active} onFormat={onFormat} />
      <span className="chat-format-sep" aria-hidden="true" />
      <ToolbarGroup actions={LIST_ACTIONS} active={active} onFormat={onFormat} />
      <span className="chat-format-sep" aria-hidden="true" />
      <ToolbarGroup actions={BLOCK_ACTIONS} active={active} onFormat={onFormat} />
    </div>
  );
}
