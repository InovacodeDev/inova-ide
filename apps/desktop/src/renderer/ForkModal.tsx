import { useEffect, useState } from 'react';
import type { Session } from '@inova/core/types';
import type { AccountView } from '../shared/api';
import { CloseIcon, GitForkIcon } from './icons';
import { PlatformSelect, type PlatformSelectOption } from './PlatformSelect';
import { ProviderBadge } from './ProviderBadge';
import { accountDisplayName, PROVIDER_NAME } from './provider-meta';
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
  const defaultAccountId = sourceAccount?.id ?? accounts[0]?.id ?? '';
  const [targetAccountId, setTargetAccountId] = useState(defaultAccountId);
  const [copyWorktreeFiles, setCopyWorktreeFiles] = useState(true);

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
      <div className="modal-card modal-card-overflow">
        <div className="modal-header">
          <GitForkIcon size={17} />
          <div className="modal-title-group">
            <h2 id="fork-modal-title" className="modal-title">
              Bifurcar sessão
            </h2>
            <span className="modal-subtitle">
              {session.title} · turno {turnIndex + 1}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar bifurcação"
            data-tooltip="Fechar bifurcação"
            data-shortcut="dismiss"
            onClick={onCancel}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-field">
            <span className="modal-field-label">Conta e provedor de destino</span>
            <PlatformSelect
              ariaLabel="Conta de destino para bifurcação"
              value={targetAccountId}
              options={options}
              onChange={setTargetAccountId}
            />
          </div>
          <p className="modal-description">
            {usesNativeFork
              ? 'Usa ramificação nativa do Claude (--fork-session) a partir do último turno.'
              : 'Gera resumo estruturado até o turno selecionado e inicia nova thread.'}
          </p>
          <label className="modal-check">
            <input
              type="checkbox"
              checked={copyWorktreeFiles}
              onChange={(event) => setCopyWorktreeFiles(event.target.checked)}
            />
            <span>Isolar alterações deste turno em Git worktree</span>
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
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
            Criar bifurcação
          </button>
        </div>
      </div>
    </div>
  );
}
