import { useMemo, useState } from 'react';
import type { SubagentSnapshot, SubagentStatus } from '@inova/core/chat-types';
import { MAX_PINNED_MEMORY_CHARS } from '@inova/core/handoff';
import type { ProviderId } from '@inova/core/types';
import type { ContextInfo } from './chat-reducer';
import {
  categoryLabel,
  isReservedCategory,
  rowParts,
  sectionLabel,
  sectionTotal,
  sortedRows,
} from './context-breakdown';
import {
  parseUnifiedGitDiff,
  splitFilePath,
  STATUS_BADGE,
  summarizeGitChanges,
} from './git-diff-presentation';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  GitBranchIcon,
  RefreshIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SwitchIcon,
} from './icons';
import { inspectorTabs, subagentSummaryCounts, type InspectorTabId } from './inspector-state';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME } from './provider-meta';
import { contextLabel, formatTokens } from './token-format';
import { useContextBreakdown } from './useContextBreakdown';
import { useSessionGitStatus } from './useSessionGitStatus';
import './session.css';

function PinnedMemoryField({
  title,
  placeholder,
  value,
  disabled = false,
  onSave,
}: {
  title: string;
  placeholder: string;
  value: string | null;
  disabled?: boolean;
  onSave: (value: string | null) => Promise<void>;
}) {
  const initialValue = value ?? '';
  const [draft, setDraft] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const normalizedDraft = draft.trim();
  const normalizedSaved = initialValue.trim();
  const dirty = normalizedDraft !== normalizedSaved;
  const remaining = MAX_PINNED_MEMORY_CHARS - draft.length;

  const commit = async (next: string | null) => {
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pinned-memory-card">
      <div className="pinned-memory-head">
        <span className="section-label">{title}</span>
        <span className="pinned-memory-count mono">{remaining}</span>
      </div>
      <textarea
        className="field pinned-memory-textarea"
        rows={3}
        maxLength={MAX_PINNED_MEMORY_CHARS}
        value={draft}
        disabled={saving || disabled}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="pinned-memory-actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={saving || disabled || (normalizedDraft === '' && normalizedSaved === '')}
          onClick={() => {
            setDraft('');
            if (normalizedSaved !== '') {
              void commit(null);
            }
          }}
        >
          Limpar
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={saving || disabled || !dirty}
          onClick={() => void commit(normalizedDraft === '' ? null : normalizedDraft)}
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}

function ContextBreakdownPanel({
  sessionId,
  usedTokens,
}: {
  sessionId: string;
  usedTokens: number | null;
}) {
  const { breakdown, error, loading, refresh } = useContextBreakdown({ sessionId, usedTokens });
  const maxTokens = Math.max(1, ...(breakdown?.categories.map((item) => item.tokens) ?? []));

  return (
    <div className="context-breakdown" aria-busy={loading}>
      <div className="context-breakdown-head">
        <span className="context-breakdown-status">
          {loading ? 'Atualizando…' : breakdown ? 'Estimativa do Claude Code' : ''}
        </span>
        <button
          type="button"
          className="icon-btn context-breakdown-refresh"
          aria-label="Atualizar detalhamento do contexto"
          data-tooltip="Atualizar detalhamento do contexto"
          disabled={loading}
          onClick={refresh}
        >
          <RefreshIcon size={13} />
        </button>
      </div>
      {error !== null ? <p className="context-breakdown-error">{error}</p> : null}
      {breakdown === null && error === null && loading ? (
        <p className="context-breakdown-empty">Lendo o contexto…</p>
      ) : null}
      {breakdown !== null ? (
        <>
          <ul className="context-breakdown-categories">
            {breakdown.categories.map((category) => (
              <li
                key={category.name}
                className="context-breakdown-category"
                data-reserved={isReservedCategory(category.name)}
              >
                <div className="context-breakdown-row">
                  <span className="context-breakdown-name">{categoryLabel(category.name)}</span>
                  <span className="context-breakdown-tokens mono">
                    {formatTokens(category.tokens)}
                    {category.percent !== null ? ` · ${category.percent}%` : ''}
                  </span>
                </div>
                {isReservedCategory(category.name) ? null : (
                  <div className="context-breakdown-bar">
                    <div
                      className="context-breakdown-bar-fill"
                      style={{ width: `${(category.tokens / maxTokens) * 100}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {breakdown.sections.map((section, sectionIndex) => (
            <details key={`${sectionIndex}-${section.title}`} className="context-breakdown-section">
              <summary className="context-breakdown-row">
                <span className="context-breakdown-name">
                  {sectionLabel(section.title)} ({section.rows.length})
                </span>
                <span className="context-breakdown-tokens mono">
                  {formatTokens(sectionTotal(section))}
                </span>
              </summary>
              <ul className="context-breakdown-items">
                {sortedRows(section).map((row, rowIndex) => {
                  const { name, detail } = rowParts(row);
                  return (
                    <li key={`${rowIndex}-${name}`} className="context-breakdown-item">
                      <div className="context-breakdown-row">
                        <span className="context-breakdown-name" title={name}>
                          {name}
                        </span>
                        <span className="context-breakdown-tokens mono">
                          {row.tokens === null ? '—' : formatTokens(row.tokens)}
                        </span>
                      </div>
                      {detail ? (
                        <span className="context-breakdown-detail mono" title={detail}>
                          {detail}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </>
      ) : null}
    </div>
  );
}

interface SessionDetailsProps {
  sessionId: string;
  subagents?: SubagentSnapshot[];
  context?: ContextInfo;
  collapsed: boolean;
  kind?: 'session' | 'subsession';
  sectionName?: string | null;
  parentTitle?: string | null;
  provider?: ProviderId | null;
  accountDisplay?: string | null;
  path?: string | null;
  worktreeBranch?: string | null;
  worktreeBusy?: boolean;
  running?: boolean;
  gitRevision?: number;
  onInspectWorktree?: (initialFilePath?: string) => void;
  onApplyWorktree?: () => void;
  onRevertFiles?: (files: string[]) => Promise<boolean>;
  onReviewDiff?: () => void;
  reviewBusy?: boolean;
  onHandoff?: () => void;
  projectPinnedMemory?: string | null;
  sessionPinnedMemory?: string | null;
  pinnedMemoryDisabled?: boolean;
  onSaveProjectPinnedMemory?: (value: string | null) => Promise<void>;
  onSaveSessionPinnedMemory?: (value: string | null) => Promise<void>;
}

const SUBAGENT_STATUS_TEXT: Record<SubagentStatus, string> = {
  running: 'rodando',
  done: 'concluído',
  error: 'erro',
};

export function SessionDetails({
  sessionId,
  subagents = [],
  context,
  collapsed,
  kind = 'session',
  sectionName = null,
  parentTitle = null,
  provider = null,
  accountDisplay = null,
  path = null,
  worktreeBranch = null,
  worktreeBusy = false,
  running = false,
  gitRevision = 0,
  onInspectWorktree,
  onApplyWorktree,
  onRevertFiles,
  onReviewDiff,
  reviewBusy = false,
  onHandoff,
  projectPinnedMemory = null,
  sessionPinnedMemory = null,
  pinnedMemoryDisabled = false,
  onSaveProjectPinnedMemory,
  onSaveSessionPinnedMemory,
}: SessionDetailsProps) {
  const contextSummary = contextLabel(context);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTabId>('context');
  const gitStatus = useSessionGitStatus({
    sessionId,
    running,
    revision: gitRevision,
  });
  const gitFiles = useMemo(
    () =>
      parseUnifiedGitDiff({
        diff: gitStatus.status?.diff ?? '',
        changedFiles: gitStatus.status?.changedFiles ?? [],
      }),
    [gitStatus.status],
  );
  const gitSummary = useMemo(() => summarizeGitChanges(gitFiles), [gitFiles]);

  if (collapsed) return null;

  const tabs = inspectorTabs({
    subagents,
    worktreeBranch,
    changedFilesCount: gitFiles.length,
  });
  const counts = subagentSummaryCounts(subagents);
  const hasActions = Boolean(
    (worktreeBranch && (onInspectWorktree || onApplyWorktree)) || onHandoff,
  );

  return (
    <aside className="session-details" aria-label="Detalhes da sessão">
      <div className="session-details-top">
        <div className="session-details-tabs" role="tablist" aria-label="Abas do inspetor">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={
                activeTab === tab.id ? 'session-details-tab active' : 'session-details-tab'
              }
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.label}</span>
              {tab.badge ? <span className="session-details-tab-badge">{tab.badge}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="session-details-body">
        {activeTab === 'context' ? (
          <section className="session-details-section">
            <div className="session-details-context">
              <span className="mono">{contextSummary.text}</span>
              {contextSummary.percent !== null ? (
                <div
                  className="session-details-meter"
                  role="progressbar"
                  aria-label="Uso do contexto"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={contextSummary.percent}
                >
                  <div
                    className="session-details-meter-fill"
                    data-high={contextSummary.percent >= 80}
                    style={{ width: `${contextSummary.percent}%` }}
                  />
                </div>
              ) : null}
              <span className="session-details-context-model mono">{context?.model ?? '—'}</span>
            </div>
            <button
              type="button"
              className="context-breakdown-toggle"
              aria-expanded={breakdownOpen}
              onClick={() => setBreakdownOpen((open) => !open)}
            >
              {breakdownOpen ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}O que
              consumiu o contexto
            </button>
            {breakdownOpen ? (
              <ContextBreakdownPanel
                key={sessionId}
                sessionId={sessionId}
                usedTokens={context?.usedTokens ?? null}
              />
            ) : null}
            {onSaveSessionPinnedMemory || onSaveProjectPinnedMemory ? (
              <div className="pinned-memory-group">
                {onSaveSessionPinnedMemory ? (
                  <PinnedMemoryField
                    key={`session:${sessionId}:${sessionPinnedMemory ?? ''}`}
                    title="Memória da sessão"
                    placeholder="Regras ou notas fixadas para esta sessão (ou use /pin no chat)..."
                    value={sessionPinnedMemory}
                    disabled={pinnedMemoryDisabled}
                    onSave={onSaveSessionPinnedMemory}
                  />
                ) : null}
                {onSaveProjectPinnedMemory ? (
                  <PinnedMemoryField
                    key={`project:${path ?? ''}:${projectPinnedMemory ?? ''}`}
                    title="Memória do projeto"
                    placeholder="Convenções, arquitetura ou restrições aplicadas a todas as sessões deste projeto..."
                    value={projectPinnedMemory}
                    disabled={pinnedMemoryDisabled}
                    onSave={onSaveProjectPinnedMemory}
                  />
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
        {activeTab === 'changes' ? (
          <section className="session-details-section">
            <div className="session-git-head">
              <div className="session-git-summary mono">
                <span>
                  {gitSummary.fileCount} {gitSummary.fileCount === 1 ? 'arquivo' : 'arquivos'}
                </span>
                {gitSummary.addedLines > 0 ? (
                  <span className="chat-diff-stat-add">+{gitSummary.addedLines}</span>
                ) : null}
                {gitSummary.removedLines > 0 ? (
                  <span className="chat-diff-stat-del">-{gitSummary.removedLines}</span>
                ) : null}
              </div>
              <div className="session-git-head-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Atualizar alterações Git"
                  data-tooltip="Atualizar alterações Git"
                  disabled={gitStatus.loading}
                  onClick={gitStatus.refresh}
                >
                  <RefreshIcon size={13} />
                </button>
              </div>
            </div>
            {gitFiles.length > 0 ? (
              <div className="session-git-actions-bar">
                {onInspectWorktree ? (
                  <button type="button" className="btn btn-sm" onClick={() => onInspectWorktree()}>
                    Ver diff
                  </button>
                ) : null}
                {onReviewDiff ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={worktreeBusy || reviewBusy}
                    onClick={onReviewDiff}
                  >
                    <ShieldCheckIcon size={12} />
                    {reviewBusy ? 'Iniciando...' : 'Revisar diff'}
                  </button>
                ) : null}
                {onRevertFiles ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={worktreeBusy}
                    onClick={() => void onRevertFiles(gitFiles.map((file) => file.path))}
                  >
                    <RotateCcwIcon size={12} />
                    Reverter tudo
                  </button>
                ) : null}
              </div>
            ) : null}
            {gitStatus.error ? <p className="context-breakdown-error">{gitStatus.error}</p> : null}
            {gitFiles.length === 0 ? (
              <p className="session-details-empty">
                {gitStatus.loading ? 'Lendo alterações Git…' : 'Nenhuma alteração Git na sessão.'}
              </p>
            ) : (
              <ul className="session-git-list">
                {gitFiles.map((file) => {
                  const { fileName, dirName } = splitFilePath(file.path);
                  return (
                    <li key={file.path} className="session-git-item">
                      <button
                        type="button"
                        className="session-git-item-main"
                        title={file.path}
                        onClick={() => onInspectWorktree?.(file.path)}
                      >
                        <span className="session-git-badge" data-status={file.status}>
                          {STATUS_BADGE[file.status]}
                        </span>
                        <span className="session-git-item-names">
                          <span className="session-git-item-name mono">{fileName}</span>
                          {dirName ? (
                            <span className="session-git-item-dir mono">{dirName}</span>
                          ) : null}
                        </span>
                        <span className="session-git-item-stats mono">
                          {file.addedLines > 0 ? (
                            <span className="chat-diff-stat-add">+{file.addedLines}</span>
                          ) : null}
                          {file.removedLines > 0 ? (
                            <span className="chat-diff-stat-del">-{file.removedLines}</span>
                          ) : null}
                        </span>
                      </button>
                      {onRevertFiles ? (
                        <button
                          type="button"
                          className="icon-btn session-git-item-revert"
                          aria-label={`Reverter ${file.path}`}
                          data-tooltip="Reverter arquivo"
                          disabled={worktreeBusy}
                          onClick={() => void onRevertFiles([file.path])}
                        >
                          <RotateCcwIcon size={12} />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
        {activeTab === 'subagents' ? (
          <section className="session-details-section">
            {subagents.length === 0 ? (
              <p className="session-details-empty">Nenhum subagente acionado nesta sessão.</p>
            ) : (
              <>
                <div className="session-details-summary mono">
                  {counts.total} {counts.total === 1 ? 'subagente' : 'subagentes'} ·{' '}
                  {formatTokens(counts.totalTokens)} total
                </div>
                <ul className="session-details-subagents">
                  {subagents.map((agent) => (
                    <li key={agent.toolId} className="session-details-subagent">
                      <div className="session-details-subagent-head">
                        <span className="session-details-subagent-name" title={agent.description}>
                          {agent.description}
                        </span>
                        <span
                          className="session-details-subagent-status"
                          data-status={agent.status}
                        >
                          {SUBAGENT_STATUS_TEXT[agent.status]}
                        </span>
                      </div>
                      <div className="session-details-subagent-meta mono">
                        {[agent.agentType, agent.model].filter(Boolean).join(' · ') || '—'}
                      </div>
                      <div className="session-details-subagent-meta mono">
                        {`${formatTokens(agent.inputTokens)} entrada · ${formatTokens(agent.outputTokens)} saída · ${formatTokens(agent.totalTokens)} total`}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ) : null}
        {activeTab === 'session' ? (
          <section className="session-details-section">
            <dl className="session-details-kv">
              <div className="session-details-kv-row">
                <dt className="session-details-kv-label">Tipo</dt>
                <dd className="session-details-kv-value">
                  {kind === 'subsession' ? 'Subsessão' : 'Sessão principal'}
                </dd>
              </div>
              {parentTitle ? (
                <div className="session-details-kv-row">
                  <dt className="session-details-kv-label">Sessão pai</dt>
                  <dd className="session-details-kv-value">{parentTitle}</dd>
                </div>
              ) : null}
              <div className="session-details-kv-row">
                <dt className="session-details-kv-label">Provedor</dt>
                <dd className="session-details-kv-value">
                  {provider ? (
                    <span className="session-details-provider">
                      <ProviderBadge provider={provider} size={16} />
                      {PROVIDER_NAME[provider]}
                    </span>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div className="session-details-kv-row">
                <dt className="session-details-kv-label">Conta</dt>
                <dd className="session-details-kv-value">{accountDisplay ?? '—'}</dd>
              </div>
              <div className="session-details-kv-row">
                <dt className="session-details-kv-label">Seção</dt>
                <dd className="session-details-kv-value">{sectionName ?? '—'}</dd>
              </div>
              <div className="session-details-kv-row">
                <dt className="session-details-kv-label">Diretório</dt>
                <dd className="session-details-kv-value" title={path ?? undefined}>
                  {path ? (
                    <span className="session-details-provider mono">
                      <FolderIcon size={12} />
                      <span>{path}</span>
                    </span>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div className="session-details-kv-row">
                <dt className="session-details-kv-label">Worktree</dt>
                <dd className="session-details-kv-value">
                  {worktreeBranch ? (
                    <span className="session-details-provider mono" title={worktreeBranch}>
                      <GitBranchIcon size={12} />
                      <span>{worktreeBranch}</span>
                    </span>
                  ) : (
                    'Diretório principal'
                  )}
                </dd>
              </div>
            </dl>
            {hasActions ? (
              <div className="session-details-actions">
                {worktreeBranch && onInspectWorktree ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-tooltip="Ver as alterações do worktree desta sessão"
                    onClick={() => onInspectWorktree()}
                  >
                    Ver diff
                  </button>
                ) : null}
                {worktreeBranch && onApplyWorktree ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-tooltip="Aplicar as alterações do worktree ao projeto"
                    disabled={worktreeBusy}
                    onClick={onApplyWorktree}
                  >
                    Aplicar
                  </button>
                ) : null}
                {onHandoff ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-tooltip="Transferir sessão para outra conta ou provedor"
                    onClick={onHandoff}
                  >
                    <SwitchIcon size={13} />
                    Transferir
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </aside>
  );
}
