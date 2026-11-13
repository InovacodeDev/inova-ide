import { useState } from 'react';
import type { UpdateInfo } from '../shared/api';
import { CloseIcon, CopyIcon, ExternalLinkIcon } from './icons';
import { UPGRADE_COMMAND } from './update-state';
import './update.css';

interface UpdateToastProps {
  info: UpdateInfo;
  onDismiss: () => void;
}

export function UpdateToast({ info, onDismiss }: UpdateToastProps) {
  const [copied, setCopied] = useState(false);
  const { releaseUrl } = info;

  const copyCommand = () => {
    void navigator.clipboard.writeText(UPGRADE_COMMAND).then(() => setCopied(true));
  };

  return (
    <div className="update-toast" role="status">
      <div className="update-toast-text">
        <span className="update-toast-title">Nova versão v{info.latest} disponível</span>
        <span className="update-toast-desc mono">{UPGRADE_COMMAND}</span>
      </div>
      <div className="update-toast-actions">
        {releaseUrl ? (
          <button
            type="button"
            className="btn"
            onClick={() => void window.inova.openExternalUrl({ url: releaseUrl })}
          >
            <ExternalLinkIcon size={13} />
            Ver novidades
          </button>
        ) : null}
        <button type="button" className="btn" onClick={copyCommand}>
          <CopyIcon size={13} />
          {copied ? 'Comando copiado' : 'Copiar comando'}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Dispensar aviso de atualização"
          onClick={onDismiss}
        >
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}
