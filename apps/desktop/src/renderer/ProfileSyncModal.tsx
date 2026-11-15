import { useEffect, useRef, useState } from 'react';
import type {
  AccountView,
  ProfileSyncApplyResult,
  ProfileSyncPreview,
  ProfileSyncStatus,
  ProjectView,
  RulesFile,
  RulesStrategy,
} from '../shared/api';
import { CloseIcon, SlidersIcon } from './icons';
import { useI18n } from './I18nContext';
import { PlatformSelect, type PlatformSelectOption } from './PlatformSelect';
import { ProviderBadge } from './ProviderBadge';
import { accountDisplayName } from './provider-meta';
import { useDialogFocus } from './useDialogFocus';
import './modal.css';
import './compare.css';

interface ProfileSyncModalProps {
  project: ProjectView;
  accounts: readonly AccountView[];
  onPreview: (input: {
    projectId: string;
    accountIds?: string[];
    rulesSource?: RulesFile | null;
    sourceAccountId?: string | null;
  }) => Promise<ProfileSyncPreview | null>;
  onApply: (input: {
    projectId: string;
    accountIds?: string[];
    rulesSource?: RulesFile | null;
    sourceAccountId?: string | null;
    approvedIds: string[];
    rulesStrategy: RulesStrategy;
  }) => Promise<ProfileSyncApplyResult | null>;
  onClose: () => void;
}

const RULES_OPTIONS: PlatformSelectOption[] = [
  { value: 'AGENTS.md', label: 'AGENTS.md' },
  { value: 'CLAUDE.md', label: 'CLAUDE.md' },
  { value: 'GEMINI.md', label: 'GEMINI.md' },
];

type TranslateFn = ReturnType<typeof useI18n>['t'];

function profileSyncStatusText(status: ProfileSyncStatus, t: TranslateFn): string {
  switch (status) {
    case 'create':
      return t('profileSync.status.create');
    case 'update':
      return t('profileSync.status.update');
    case 'unchanged':
      return t('profileSync.status.unchanged');
    case 'conflict':
      return t('profileSync.status.conflict');
    case 'incompatible':
      return t('profileSync.status.incompatible');
  }
}

export function ProfileSyncModal({
  project,
  accounts,
  onPreview,
  onApply,
  onClose,
}: ProfileSyncModalProps) {
  const { t } = useI18n();
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(() =>
    accounts.map((account) => account.id),
  );
  const [rulesSource, setRulesSource] = useState<RulesFile | null>(null);
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null);
  const [rulesStrategy, setRulesStrategy] = useState<RulesStrategy>('copy');
  const [preview, setPreview] = useState<ProfileSyncPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [approvedIds, setApprovedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ProfileSyncApplyResult | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useDialogFocus(cardRef);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (alive) {
        setLoading(true);
        setPreviewFailed(false);
      }
    });
    void onPreview({
      projectId: project.id,
      accountIds: selectedAccounts,
      ...(rulesSource ? { rulesSource } : {}),
      ...(sourceAccountId ? { sourceAccountId } : {}),
    })
      .then((next) => {
        if (!alive) return;
        if (!next) {
          setPreview(null);
          setPreviewFailed(true);
          return;
        }
        setPreview(next);
        setPreviewFailed(false);
        setApprovedIds(
          next.items.filter((item) => item.status === 'create').map((item) => item.id),
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [project.id, selectedAccounts, rulesSource, sourceAccountId, onPreview]);

  const toggleAccount = (id: string) => {
    setResult(null);
    setSelectedAccounts((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleApproved = (id: string) => {
    setApprovedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const applyableCount =
    preview?.items.filter(
      (item) =>
        item.status === 'create' ||
        ((item.status === 'update' || item.status === 'conflict') && approvedIds.includes(item.id)),
    ).length ?? 0;

  const submitApply = async () => {
    if (!preview || applyableCount === 0) return;
    setApplying(true);
    try {
      const effectiveRules = preview.rulesSource ?? rulesSource;
      const applied = await onApply({
        projectId: project.id,
        accountIds: selectedAccounts,
        rulesSource: effectiveRules,
        ...(sourceAccountId ? { sourceAccountId } : {}),
        approvedIds,
        rulesStrategy,
      });
      if (applied) {
        setResult(applied);
        const refreshed = await onPreview({
          projectId: project.id,
          accountIds: selectedAccounts,
          ...(effectiveRules ? { rulesSource: effectiveRules } : {}),
          ...(sourceAccountId ? { sourceAccountId } : {}),
        });
        if (refreshed) setPreview(refreshed);
      }
    } finally {
      setApplying(false);
    }
  };

  const activeRulesValue = rulesSource ?? preview?.rulesSource ?? 'AGENTS.md';
  const strategyOptions: PlatformSelectOption[] = [
    { value: 'copy', label: t('profileSync.strategy.copy') },
    { value: 'symlink', label: t('profileSync.strategy.symlink') },
  ];
  const importOptions: PlatformSelectOption[] = [
    { value: '', label: t('profileSync.noImportSource') },
    ...accounts.map((account) => ({
      value: account.id,
      label: accountDisplayName(account),
      leading: <ProviderBadge provider={account.provider} size={16} />,
    })),
  ];

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-sync-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={cardRef} tabIndex={-1} className="modal-card modal-card-overflow sync-modal-card">
        <div className="modal-header">
          <SlidersIcon size={17} />
          <div className="modal-title-group">
            <h2 id="profile-sync-title" className="modal-title">
              {t('profileSync.title')}
            </h2>
            <span className="modal-subtitle">{project.path}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('profileSync.close')}
            data-tooltip={t('profileSync.close')}
            data-shortcut="dismiss"
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body sync-modal-body">
          <div className="sync-controls">
            <div className="modal-field">
              <span className="modal-field-label">{t('profileSync.rulesFileLabel')}</span>
              <PlatformSelect
                ariaLabel={t('profileSync.rulesFileLabel')}
                value={activeRulesValue}
                options={RULES_OPTIONS}
                onChange={(value) => setRulesSource(value as RulesFile)}
              />
            </div>
            <div className="modal-field">
              <span className="modal-field-label">{t('profileSync.strategyLabel')}</span>
              <PlatformSelect
                ariaLabel={t('profileSync.strategyLabel')}
                value={rulesStrategy}
                options={strategyOptions}
                onChange={(value) => setRulesStrategy(value as RulesStrategy)}
              />
            </div>
            {preview && !preview.mcpSourceExists ? (
              <div className="modal-field">
                <span className="modal-field-label">{t('profileSync.importMcpLabel')}</span>
                <PlatformSelect
                  ariaLabel={t('profileSync.importMcpLabel')}
                  value={sourceAccountId ?? ''}
                  options={importOptions}
                  onChange={(value) => setSourceAccountId(value === '' ? null : value)}
                />
              </div>
            ) : null}
          </div>

          <div className="modal-field">
            <span className="modal-field-label">{t('profileSync.targetAccountsLabel')}</span>
            <div className="sync-accounts">
              {accounts.map((account) => (
                <label key={account.id} className="modal-check">
                  <input
                    type="checkbox"
                    checked={selectedAccounts.includes(account.id)}
                    onChange={() => toggleAccount(account.id)}
                  />
                  <ProviderBadge provider={account.provider} size={16} />
                  <span>{accountDisplayName(account)}</span>
                </label>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="hint">{t('profileSync.analyzing')}</p>
          ) : previewFailed ? (
            <p className="modal-description">{t('profileSync.previewFailed')}</p>
          ) : preview ? (
            <>
              <p className="modal-description">
                {preview.mcpSourceExists
                  ? t('profileSync.mcpFound', { count: preview.mcpServerCount })
                  : t('profileSync.mcpMissing')}
                {preview.rulesSource
                  ? t('profileSync.rulesFound', { file: preview.rulesSource })
                  : t('profileSync.rulesMissing')}
              </p>
              <div className="sync-items">
                {preview.items.map((item) => {
                  const needsApproval = item.status === 'update' || item.status === 'conflict';
                  return (
                    <div key={item.id} className="sync-item">
                      <div className="sync-item-head">
                        {needsApproval ? (
                          <label className="modal-check">
                            <input
                              type="checkbox"
                              checked={approvedIds.includes(item.id)}
                              onChange={() => toggleApproved(item.id)}
                            />
                            <span>{t('profileSync.approveChange')}</span>
                          </label>
                        ) : null}
                        <ProviderBadge provider={item.provider} size={16} />
                        <span className="mono">{item.targetPath}</span>
                        <span className={`sync-status-pill sync-status-${item.status}`}>
                          {profileSyncStatusText(item.status, t)}
                        </span>
                      </div>
                      {item.reason ? <div className="hint">{item.reason}</div> : null}
                      {item.status !== 'unchanged' && item.status !== 'incompatible' ? (
                        <div className="sync-preview-grid">
                          <pre className="sync-preview-pre mono">
                            {item.maskedBefore === ''
                              ? t('profileSync.emptyPreview')
                              : item.maskedBefore}
                          </pre>
                          <pre className="sync-preview-pre mono">{item.maskedAfter}</pre>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {result ? (
            <p className="modal-description">
              {t('profileSync.resultSuccess', { count: result.appliedIds.length })}
              <span className="mono">{result.backupDir}</span>.
            </p>
          ) : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={applying || loading || applyableCount === 0}
            onClick={() => void submitApply()}
          >
            {applying
              ? t('profileSync.applying')
              : t('profileSync.applyCount', { count: applyableCount })}
          </button>
        </div>
      </div>
    </div>
  );
}
