import type { ProviderId } from '@inova/core/types';
import { CloseIcon, FolderIcon } from './icons';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME } from './provider-meta';
import { STATUS_LABEL, type SessionStatus } from './session-status';
import './session.css';

interface SessionHeaderProps {
  title: string;
  provider: ProviderId | null;
  accountLabel: string | null;
  path: string | null;
  status: SessionStatus | null;
  exited?: boolean;
  onClose: () => void;
}

export function SessionHeader(props: SessionHeaderProps) {
  const { title, provider, accountLabel, path, status, exited, onClose } = props;
  return (
    <div className="session-header">
      <div className="session-header-main">
        <h1 className="session-header-title">{title}</h1>
        <div className="session-header-meta">
          {provider ? (
            <span className="session-header-item">
              <ProviderBadge provider={provider} size={18} />
              {PROVIDER_NAME[provider]}
              {accountLabel !== null ? ` · ${accountLabel}` : ''}
            </span>
          ) : null}
          {path ? (
            <span className="session-header-item" title={path}>
              <FolderIcon size={14} />
              <span className="mono session-header-path">{path}</span>
            </span>
          ) : null}
          {exited ? (
            <span className="pill pill-idle">
              <span className="dot" />
              Encerrado
            </span>
          ) : status !== null && status !== 'idle' ? (
            <span className={`pill pill-${status}`}>
              <span className={status === 'running' ? 'dot pulse' : 'dot'} />
              {STATUS_LABEL[status]}
            </span>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label="Fechar sessão"
        title="Fechar sessão"
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
