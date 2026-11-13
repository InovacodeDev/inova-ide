import { useEffect } from 'react';
import { CloseIcon } from './icons';
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
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 id="confirm-modal-title" className="modal-title">
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar confirmação"
            data-tooltip="Fechar confirmação"
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
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            autoFocus
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
