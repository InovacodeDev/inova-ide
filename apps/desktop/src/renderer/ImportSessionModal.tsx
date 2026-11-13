import { useEffect, useMemo, useState } from 'react';
import type {
  AccountView,
  ExternalSessionView,
  ImportProvider,
  ProjectView,
  Result,
} from '../shared/api';
import { CloseIcon, DownloadIcon } from './icons';
import { buildImportGroups, formatBytes, selectableIds } from './import-state';
import { folderName } from './path-name';
import { PlatformSelect } from './PlatformSelect';
import { ProviderBadge } from './ProviderBadge';
import { accountDisplayName, PROVIDER_NAME } from './provider-meta';
import { relativeTime } from './relative-time';
import './modal.css';

export interface ImportRequest {
  provider: ImportProvider;
  accountId: string;
  sessionIds: string[];
}

interface ImportSessionModalProps {
  project: ProjectView;
  accounts: readonly AccountView[];
  onList: (projectId: string) => Promise<Result<ExternalSessionView[]>>;
  onImport: (requests: ImportRequest[]) => Promise<void>;
  onClose: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; sessions: ExternalSessionView[] };

export function ImportSessionModal({
  project,
  accounts,
  onList,
  onImport,
  onClose,
}: ImportSessionModalProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [targets, setTargets] = useState<Partial<Record<ImportProvider, string>>>({});
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let active = true;
    void onList(project.id).then(
      (result) => {
        if (!active) return;
        setState(
          result.ok
            ? { status: 'ready', sessions: result.value }
            : { status: 'error', message: result.message },
        );
      },
      () => {
        if (active) setState({ status: 'error', message: 'Erro inesperado.' });
      },
    );
    return () => {
      active = false;
    };
  }, [onList, project.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const groups = useMemo(
    () =>
      state.status === 'ready'
        ? buildImportGroups({
            sessions: state.sessions,
            accounts,
            projectProvider: project.provider,
            projectAccountLabel: project.accountLabel,
          })
        : [],
    [state, accounts, project.provider, project.accountLabel],
  );

  const requests: ImportRequest[] = groups.flatMap((group) => {
    const sessionIds = selectableIds(group).filter((id) => selected.has(id));
    const accountId = targets[group.provider] ?? group.defaultAccountId;
    return sessionIds.length > 0 && accountId !== ''
      ? [{ provider: group.provider, accountId, sessionIds }]
      : [];
  });
  const total = requests.reduce((sum, request) => sum + request.sessionIds.length, 0);
  const now = new Date();

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    setImporting(true);
    try {
      await onImport(requests);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card modal-card-overflow import-card">
        <div className="modal-header">
          <DownloadIcon size={17} />
          <div className="modal-title-group">
            <h2 id="import-modal-title" className="modal-title">
              Importar sessões
            </h2>
            <span className="modal-subtitle" title={project.path}>
              {folderName(project.path)} · sessões criadas fora do Inova IDE nesta pasta
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar importação"
            data-tooltip="Fechar importação"
            data-shortcut="dismiss"
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body import-body">
          {state.status === 'loading' && <p className="modal-description">Procurando sessões…</p>}
          {state.status === 'error' && <p className="modal-description">{state.message}</p>}
          {state.status === 'ready' && groups.length === 0 && (
            <p className="modal-description">
              Nenhuma sessão externa do Claude Code ou do Codex encontrada para esta pasta.
            </p>
          )}
          {groups.map((group) => (
            <section key={group.provider} className="import-group">
              <div className="import-group-header">
                <ProviderBadge provider={group.provider} size={18} />
                <span className="import-group-title">{PROVIDER_NAME[group.provider]}</span>
                {group.accounts.length > 1 && (
                  <PlatformSelect
                    ariaLabel={`Conta de destino para ${PROVIDER_NAME[group.provider]}`}
                    value={targets[group.provider] ?? group.defaultAccountId}
                    options={group.accounts.map((account) => ({
                      value: account.id,
                      label: accountDisplayName(account),
                    }))}
                    onChange={(accountId) =>
                      setTargets((current) => ({ ...current, [group.provider]: accountId }))
                    }
                  />
                )}
              </div>
              {group.accounts.length === 0 && (
                <p className="import-note">
                  Adicione uma conta {PROVIDER_NAME[group.provider]} para importar estas sessões.
                </p>
              )}
              <ul className="import-list">
                {group.sessions.map((session) => {
                  const disabled = session.imported || group.accounts.length === 0;
                  return (
                    <li key={session.id}>
                      <label className={disabled ? 'import-row import-row-disabled' : 'import-row'}>
                        <input
                          type="checkbox"
                          disabled={disabled || importing}
                          checked={selected.has(session.id)}
                          onChange={() => toggle(session.id)}
                        />
                        <span className="import-row-title">{session.title}</span>
                        <span className="import-row-meta">
                          {session.imported
                            ? 'já importada'
                            : `${relativeTime({ iso: session.updatedAt, now })} · ${formatBytes(session.sizeBytes)}`}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={total === 0 || importing}
            onClick={() => void confirm()}
          >
            {importing ? 'Importando…' : total > 0 ? `Importar (${total})` : 'Importar'}
          </button>
        </div>
      </div>
    </div>
  );
}
