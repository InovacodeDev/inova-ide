import { useState } from 'react';
import type { UpdateInfo } from '../shared/api';
import { useI18n } from './I18nContext';
import { CloseIcon, CopyIcon, ExternalLinkIcon } from './icons';
import { UPGRADE_COMMAND } from './update-state';
import './update.css';

interface UpdateToastProps {
  info: UpdateInfo;
  onDismiss: () => void;
}

export function UpdateToast({ info, onDismiss }: UpdateToastProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const { releaseUrl } = info;

  const copyCommand = () => {
    void navigator.clipboard.writeText(UPGRADE_COMMAND).then(() => setCopied(true));
  };

  return (
    <div className="update-toast" role="status">
      <div className="update-toast-text">
        <span className="update-toast-title">
          {t('update.availableTitle', { version: info.latest ?? '' })}
        </span>
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
            {t('update.viewNotes')}
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          data-tooltip={t('update.copyTooltip')}
          onClick={copyCommand}
        >
          <CopyIcon size={13} />
          {copied ? t('update.copiedCommand') : t('update.copyCommand')}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('update.dismissLabel')}
          data-tooltip={t('update.dismissLabel')}
          onClick={onDismiss}
        >
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}
