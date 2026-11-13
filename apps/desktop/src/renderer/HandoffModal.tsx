import { useEffect, useState } from 'react';
import type { Session } from '@inova/core/types';
import type { AccountView } from '../shared/api';
import { CloseIcon, SwitchIcon } from './icons';
import { PlatformSelect, type PlatformSelectOption } from './PlatformSelect';
import { ProviderBadge } from './ProviderBadge';
import { accountDisplayName, PROVIDER_NAME } from './provider-meta';
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
  const alternatives = accounts.filter((account) => account.id !== sourceAccount?.id);
  const [targetAccountId, setTargetAccountId] = useState(alternatives[0]?.id ?? '');
  const [createWorktree, setCreateWorktree] = useState(false);

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
      <div className="modal-card modal-card-overflow">
        <div className="modal-header">
          <SwitchIcon size={17} />
          <div className="modal-title-group">
            <h2 id="handoff-modal-title" className="modal-title">
              Transferir sessão (Handoff)
            </h2>
            <span className="modal-subtitle">{session.title}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar transferência"
            onClick={onCancel}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body">
          {alternatives.length === 0 ? (
            <p className="modal-description">
              Adicione outra conta ou provedor em Contas e providers antes de transferir.
            </p>
          ) : (
            <>
              <div className="modal-field">
                <span className="modal-field-label">Conta de destino</span>
                <PlatformSelect
                  ariaLabel="Conta de destino para handoff"
                  value={targetAccountId}
                  options={options}
                  onChange={setTargetAccountId}
                />
              </div>
              <p className="modal-description">
                Cria uma nova sessão com resumo estruturado dos últimos turnos e dos arquivos
                alterados para continuar sem perda de contexto.
              </p>
              <label className="modal-check">
                <input
                  type="checkbox"
                  checked={createWorktree}
                  onChange={(event) => setCreateWorktree(event.target.checked)}
                />
                <span>Criar novo Git worktree isolado</span>
              </label>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={targetAccountId === '' || alternatives.length === 0}
            onClick={() => onConfirm({ targetAccountId, createWorktree })}
          >
            Gerar handoff e abrir
          </button>
        </div>
      </div>
    </div>
  );
}
