import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AttachmentKind } from '../shared/api';
import { FileTextIcon, FolderIcon, ImageIcon, PaperclipIcon } from './icons';

const OPTIONS: readonly { kind: AttachmentKind; label: string; icon: ReactNode }[] = [
  { kind: 'images', label: 'Fotos e imagens', icon: <ImageIcon /> },
  { kind: 'documents', label: 'Documentos', icon: <FileTextIcon /> },
  { kind: 'any', label: 'Arquivos ou pastas', icon: <FolderIcon /> },
];

export interface AttachMenuProps {
  onPick: (kind: AttachmentKind) => void;
}

export function AttachMenu({ onPick }: AttachMenuProps) {
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
        aria-label="Anexar arquivos"
        title="Anexar arquivos"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <PaperclipIcon size={16} />
      </button>
      {open ? (
        <div className="chat-picker-popover chat-attach-popover" role="menu">
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
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
