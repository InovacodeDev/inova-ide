import { useEffect, useRef, useState } from 'react';
import type { Session } from '@inova/core/types';
import type { AccountView } from '../shared/api';
import { CloseIcon, SwitchIcon } from './icons';
import { useI18n } from './I18nContext';
import { PlatformSelect, type PlatformSelectOption } from './PlatformSelect';
import { ProviderBadge } from './ProviderBadge';
import { accountDisplayName, PROVIDER_NAME } from './provider-meta';
import { useDialogFocus } from './useDialogFocus';
import './modal.css';

interface HandoffModalProps {
  session: Session;
  sourceAccount: AccountView | undefined;
  accounts: readonly AccountView[];
  onConfirm: (input: { targetAccountId: string; createWorktree: boolean }) => void;
  onCancel: () => void;
}

export function HandoffModal({
  session,
  sourceAccount,
  accounts,
  onConfirm,
  onCancel,
}: HandoffModalProps) {
  const { t } = useI18n();
  const alternatives = accounts.filter((account) => account.id !== sourceAccount?.id);
  const [targetAccountId, setTargetAccountId] = useState(alternatives[0]?.id ?? '');
  const [createWorktree, setCreateWorktree] = useState(false);
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

  const options: PlatformSelectOption[] = alternatives.map((account) => ({
    value: account.id,
    label: accountDisplayName(account),
    description: PROVIDER_NAME[account.provider],
    leading: <ProviderBadge provider={account.provider} size={16} />,
  }));

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="handoff-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div ref={cardRef} tabIndex={-1} className="modal-card modal-card-overflow">
        <div className="modal-header">
          <SwitchIcon size={17} />
          <div className="modal-title-group">
            <h2 id="handoff-modal-title" className="modal-title">
              {t('handoff.title')}
            </h2>
            <span className="modal-subtitle">{session.title}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('handoff.close')}
            data-tooltip={t('handoff.close')}
            data-shortcut="dismiss"
            onClick={onCancel}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body">
          {alternatives.length === 0 ? (
            <p className="modal-description">{t('handoff.noAccounts')}</p>
          ) : (
            <>
              <div className="modal-field">
                <span className="modal-field-label">{t('handoff.targetLabel')}</span>
                <PlatformSelect
                  ariaLabel={t('handoff.targetAria')}
                  value={targetAccountId}
                  options={options}
                  onChange={setTargetAccountId}
                />
              </div>
              <p className="modal-description">{t('handoff.desc')}</p>
              <label className="modal-check">
                <input
                  type="checkbox"
                  checked={createWorktree}
                  onChange={(event) => setCreateWorktree(event.target.checked)}
                />
                <span>{t('handoff.worktree')}</span>
              </label>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={targetAccountId === '' || alternatives.length === 0}
            onClick={() => onConfirm({ targetAccountId, createWorktree })}
          >
            {t('handoff.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
