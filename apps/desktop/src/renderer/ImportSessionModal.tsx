import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccountView,
  ExternalSessionView,
  ImportProvider,
  ProjectView,
  Result,
} from '../shared/api';
import { CloseIcon, DownloadIcon } from './icons';
import { useI18n } from './I18nContext';
import { buildImportGroups, formatBytes, selectableIds } from './import-state';
import { folderName } from './path-name';
import { PlatformSelect } from './PlatformSelect';
import { ProviderBadge } from './ProviderBadge';
import { accountDisplayName, PROVIDER_NAME } from './provider-meta';
import { relativeTime } from './relative-time';
import { useDialogFocus } from './useDialogFocus';
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
  const { locale, t } = useI18n();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [targets, setTargets] = useState<Partial<Record<ImportProvider, string>>>({});
  const [importing, setImporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const unexpectedRef = useRef(t('alerts.unexpected'));
  unexpectedRef.current = t('alerts.unexpected');

  useDialogFocus(cardRef);

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
        if (active) setState({ status: 'error', message: unexpectedRef.current });
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
      <div ref={cardRef} tabIndex={-1} className="modal-card modal-card-overflow import-card">
        <div className="modal-header">
          <DownloadIcon size={17} />
          <div className="modal-title-group">
            <h2 id="import-modal-title" className="modal-title">
              {t('importSession.title')}
            </h2>
            <span className="modal-subtitle" title={project.path}>
              {t('importSession.subtitle', { folder: folderName(project.path) })}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('importSession.close')}
            data-tooltip={t('importSession.close')}
            data-shortcut="dismiss"
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body import-body">
          {state.status === 'loading' && (
            <p className="modal-description">{t('importSession.loading')}</p>
          )}
          {state.status === 'error' && <p className="modal-description">{state.message}</p>}
          {state.status === 'ready' && groups.length === 0 && (
            <p className="modal-description">{t('importSession.empty')}</p>
          )}
          {groups.map((group) => (
            <section key={group.provider} className="import-group">
              <div className="import-group-header">
                <ProviderBadge provider={group.provider} size={18} />
                <span className="import-group-title">{PROVIDER_NAME[group.provider]}</span>
                {group.accounts.length > 1 && (
                  <PlatformSelect
                    ariaLabel={t('importSession.providerTargetAria', {
                      provider: PROVIDER_NAME[group.provider],
                    })}
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
                  {t('importSession.addAccountNote', { provider: PROVIDER_NAME[group.provider] })}
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
                            ? t('importSession.alreadyImported')
                            : `${relativeTime({ iso: session.updatedAt, now, locale })} · ${formatBytes(session.sizeBytes)}`}
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
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={total === 0 || importing}
            onClick={() => void confirm()}
          >
            {importing
              ? t('importSession.importing')
              : total > 0
                ? t('importSession.submitCount', { count: total })
                : t('importSession.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
