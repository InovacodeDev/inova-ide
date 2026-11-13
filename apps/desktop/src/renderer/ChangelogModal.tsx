import { useEffect, useRef } from 'react';
import changelogSource from '../../../../CHANGELOG.md?raw';
import { CloseIcon } from './icons';
import { Markdown } from './Markdown';
import { openModalCount } from './modal-layers';
import { changelogTitle, publishedChangelog } from './update-state';
import './modal.css';
import './update.css';

const changelog = publishedChangelog(changelogSource);

interface ChangelogModalProps {
  version: string | null;
  whatsNew: boolean;
  onClose: () => void;
}

export function ChangelogModal({ version, whatsNew, onClose }: ChangelogModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    cardRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || openModalCount() > 1) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="changelog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={cardRef} className="modal-card changelog-card" tabIndex={-1}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 id="changelog-title" className="modal-title">
              {changelogTitle({ whatsNew, version })}
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar novidades"
            data-tooltip="Fechar novidades"
            data-shortcut="dismiss"
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body changelog-body">
          <Markdown text={changelog} />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
