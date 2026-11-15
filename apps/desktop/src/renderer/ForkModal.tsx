import { useEffect, useRef, useState } from 'react';
import type { Session } from '@inova/core/types';
import type { AccountView } from '../shared/api';
import { CloseIcon, GitForkIcon } from './icons';
import { useI18n } from './I18nContext';
import { PlatformSelect, type PlatformSelectOption } from './PlatformSelect';
import { ProviderBadge } from './ProviderBadge';
import { accountDisplayName, PROVIDER_NAME } from './provider-meta';
import { useDialogFocus } from './useDialogFocus';
import './modal.css';

interface ForkModalProps {
  session: Session;
  turnIndex: number;
  isLatestTurn: boolean;
  sourceAccount: AccountView | undefined;
  accounts: readonly AccountView[];
  onConfirm: (input: { targetAccountId?: string; copyWorktreeFiles: boolean }) => void;
  onCancel: () => void;
}

export function ForkModal({
  session,
  turnIndex,
  isLatestTurn,
  sourceAccount,
  accounts,
  onConfirm,
  onCancel,
}: ForkModalProps) {
  const { t } = useI18n();
  const defaultAccountId = sourceAccount?.id ?? accounts[0]?.id ?? '';
  const [targetAccountId, setTargetAccountId] = useState(defaultAccountId);
  const [copyWorktreeFiles, setCopyWorktreeFiles] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  useDialogFocus(cardRef);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const options: PlatformSelectOption[] = accounts.map((account) => ({
    value: account.id,
    label: accountDisplayName(account),
    description: PROVIDER_NAME[account.provider],
    leading: <ProviderBadge provider={account.provider} size={16} />,
  }));

  const usesNativeFork =
    sourceAccount?.provider === 'claude' && targetAccountId === sourceAccount.id && isLatestTurn;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fork-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div ref={cardRef} tabIndex={-1} className="modal-card modal-card-overflow">
        <div className="modal-header">
          <GitForkIcon size={17} />
          <div className="modal-title-group">
            <h2 id="fork-modal-title" className="modal-title">
              {t('fork.title')}
            </h2>
            <span className="modal-subtitle">
              {t('fork.subtitle', { title: session.title, turn: turnIndex + 1 })}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('fork.close')}
            data-tooltip={t('fork.close')}
            data-shortcut="dismiss"
            onClick={onCancel}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-field">
            <span className="modal-field-label">{t('fork.targetLabel')}</span>
            <PlatformSelect
              ariaLabel={t('fork.targetAria')}
              value={targetAccountId}
              options={options}
              onChange={setTargetAccountId}
            />
          </div>
          <p className="modal-description">
            {usesNativeFork ? t('fork.nativeDesc') : t('fork.summaryDesc')}
          </p>
          <label className="modal-check">
            <input
              type="checkbox"
              checked={copyWorktreeFiles}
              onChange={(event) => setCopyWorktreeFiles(event.target.checked)}
            />
            <span>{t('fork.worktree')}</span>
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={targetAccountId === ''}
            onClick={() =>
              onConfirm({
                ...(targetAccountId && targetAccountId !== sourceAccount?.id
                  ? { targetAccountId }
                  : {}),
                copyWorktreeFiles,
              })
            }
          >
            {t('fork.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
