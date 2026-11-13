import { useEffect, useState } from 'react';
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
import { PlatformSelect, type PlatformSelectOption } from './PlatformSelect';
import { ProviderBadge } from './ProviderBadge';
import { accountDisplayName } from './provider-meta';
import './modal.css';
import './compare.css';

interface ProfileSyncModalProps {
  project: ProjectView;
  accounts: readonly AccountView[];
  onPreview: (input: {
    projectId: string;
    accountIds?: string[];
    rulesSource?: RulesFile | null;
  }) => Promise<ProfileSyncPreview | null>;
  onApply: (input: {
    projectId: string;
    accountIds?: string[];
    rulesSource?: RulesFile | null;
    approvedIds: string[];
    rulesStrategy: RulesStrategy;
  }) => Promise<ProfileSyncApplyResult | null>;
  onClose: () => void;
}

const STATUS_TEXT: Record<ProfileSyncStatus, string> = {
  create: 'Novo',
  update: 'Atualizar',
  unchanged: 'Igual',
  conflict: 'Conflito',
  incompatible: 'Incompatível',
};

const RULES_OPTIONS: PlatformSelectOption[] = [
  { value: 'AGENTS.md', label: 'AGENTS.md' },
  { value: 'CLAUDE.md', label: 'CLAUDE.md' },
  { value: 'GEMINI.md', label: 'GEMINI.md' },
];

const STRATEGY_OPTIONS: PlatformSelectOption[] = [
  { value: 'copy', label: 'Cópia sincronizada' },
  { value: 'symlink', label: 'Link simbólico (quando possível)' },
];

export function ProfileSyncModal({
  project,
  accounts,
  onPreview,
  onApply,
  onClose,
}: ProfileSyncModalProps) {
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(() =>
    accounts.map((account) => account.id),
  );
  const [rulesSource, setRulesSource] = useState<RulesFile>('AGENTS.md');
  const [rulesStrategy, setRulesStrategy] = useState<RulesStrategy>('copy');
  const [preview, setPreview] = useState<ProfileSyncPreview | null>(null);
  const [approvedIds, setApprovedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ProfileSyncApplyResult | null>(null);

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
      if (alive) setLoading(true);
    });
    void onPreview({
      projectId: project.id,
      accountIds: selectedAccounts,
      rulesSource,
    })
      .then((next) => {
        if (!alive || !next) return;
        setPreview(next);
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
  }, [project.id, selectedAccounts, rulesSource, onPreview]);

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
      const applied = await onApply({
        projectId: project.id,
        accountIds: selectedAccounts,
        rulesSource: preview.rulesSource ?? rulesSource,
        approvedIds,
        rulesStrategy,
      });
      if (applied) {
        setResult(applied);
        const refreshed = await onPreview({
          projectId: project.id,
          accountIds: selectedAccounts,
          rulesSource,
        });
        if (refreshed) setPreview(refreshed);
      }
    } finally {
      setApplying(false);
    }
  };

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
      <div className="modal-card sync-modal-card">
        <div className="modal-header">
          <SlidersIcon size={17} />
          <div className="modal-title-group">
            <h2 id="profile-sync-title" className="modal-title">
              Perfil unificado de MCPs e regras
            </h2>
            <span className="modal-subtitle">{project.path}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar sincronização"
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body sync-modal-body">
          <div className="sync-controls">
            <div className="modal-field">
              <span className="modal-field-label">Arquivo-fonte de regras</span>
              <PlatformSelect
                ariaLabel="Arquivo-fonte de regras"
                value={rulesSource}
                options={RULES_OPTIONS}
                onChange={(value) => setRulesSource(value as RulesFile)}
              />
            </div>
            <div className="modal-field">
              <span className="modal-field-label">Estratégia para regras</span>
              <PlatformSelect
                ariaLabel="Estratégia para regras"
                value={rulesStrategy}
                options={STRATEGY_OPTIONS}
                onChange={(value) => setRulesStrategy(value as RulesStrategy)}
              />
            </div>
          </div>

          <div className="modal-field">
            <span className="modal-field-label">Contas de destino</span>
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
            <p className="hint">Analisando configurações e segredos mascarados…</p>
          ) : preview ? (
            <>
              <p className="modal-description">
                {preview.mcpSourceExists
                  ? `.mcp.json encontrado (${preview.mcpServerCount} servidor(es) MCP). `
                  : 'Nenhum .mcp.json encontrado na raiz do projeto. '}
                {preview.rulesSource
                  ? `Regras base: ${preview.rulesSource}.`
                  : 'Nenhum arquivo de regras encontrado.'}
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
                            <span>Aprovar alteração</span>
                          </label>
                        ) : null}
                        <ProviderBadge provider={item.provider} size={16} />
                        <span className="mono">{item.targetPath}</span>
                        <span className={`sync-status-pill sync-status-${item.status}`}>
                          {STATUS_TEXT[item.status]}
                        </span>
                      </div>
                      {item.reason ? <div className="hint">{item.reason}</div> : null}
                      {item.status !== 'unchanged' && item.status !== 'incompatible' ? (
                        <div className="sync-preview-grid">
                          <pre className="sync-preview-pre mono">
                            {item.maskedBefore === '' ? '(vazio)' : item.maskedBefore}
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
              Sincronização concluída ({result.appliedIds.length} item(ns)). Backup salvo em{' '}
              <span className="mono">{result.backupDir}</span>.
            </p>
          ) : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Fechar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={applying || loading || applyableCount === 0}
            onClick={() => void submitApply()}
          >
            {applying ? 'Aplicando…' : `Aplicar sincronização (${applyableCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
