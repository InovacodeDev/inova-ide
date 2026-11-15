import { useEffect, useRef } from 'react';
import { useI18n } from './I18nContext';
import { CloseIcon } from './icons';
import { useDialogFocus } from './useDialogFocus';
import './modal.css';

interface ConfirmModalProps {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  description,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useDialogFocus(cardRef);

  useEffect(() => {
    (danger ? cancelRef.current : confirmRef.current)?.focus();
  }, [danger]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div ref={cardRef} tabIndex={-1} className="modal-card">
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 id="confirm-modal-title" className="modal-title">
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('confirm.closeLabel')}
            data-tooltip={t('confirm.closeLabel')}
            data-shortcut="dismiss"
            onClick={onCancel}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-description">{description}</p>
        </div>
        <div className="modal-footer">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
