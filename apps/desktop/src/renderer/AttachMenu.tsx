import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AttachmentKind } from '../shared/api';
import type { TranslationKey } from './i18n';
import { useI18n } from './I18nContext';
import { FileTextIcon, FolderIcon, ImageIcon, PaperclipIcon } from './icons';

const OPTIONS: readonly { kind: AttachmentKind; labelKey: TranslationKey; icon: ReactNode }[] = [
  { kind: 'images', labelKey: 'attach.photos', icon: <ImageIcon /> },
  { kind: 'documents', labelKey: 'attach.documents', icon: <FileTextIcon /> },
  { kind: 'any', labelKey: 'attach.filesOrFolders', icon: <FolderIcon /> },
];

export interface AttachMenuProps {
  onPick: (kind: AttachmentKind) => void;
}

export function AttachMenu({ onPick }: AttachMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
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
    <div className="chat-picker chat-attach" ref={containerRef}>
      <button
        type="button"
        className={open ? 'chat-attach-btn chat-attach-btn-open' : 'chat-attach-btn'}
        aria-label={t('attach.ariaLabel')}
        data-tooltip={t('attach.tooltip')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <PaperclipIcon size={16} />
      </button>
      {open ? (
        <div
          className="chat-picker-popover chat-attach-popover"
          role="menu"
          aria-label={t('attach.menuAria')}
        >
          {OPTIONS.map((option) => (
            <button
              key={option.kind}
              type="button"
              role="menuitem"
              className="chat-attach-item"
              onClick={() => {
                setOpen(false);
                onPick(option.kind);
              }}
            >
              {option.icon}
              <span>{t(option.labelKey)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
