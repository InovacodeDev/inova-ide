import { useState } from 'react';
import type { SubagentSnapshot, SubagentStatus } from '@inova/core/chat-types';
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
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  GitBranchIcon,
  PanelRightCloseIcon,
  RefreshIcon,
  SwitchIcon,
} from './icons';
import { inspectorTabs, subagentSummaryCounts, type InspectorTabId } from './inspector-state';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME } from './provider-meta';
import { contextLabel, formatTokens } from './token-format';
import { useContextBreakdown } from './useContextBreakdown';
import './session.css';

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
  onToggleCollapsed: () => void;
  kind?: 'session' | 'subsession';
  sectionName?: string | null;
  parentTitle?: string | null;
  provider?: ProviderId | null;
  accountDisplay?: string | null;
  path?: string | null;
  worktreeBranch?: string | null;
  worktreeBusy?: boolean;
  onInspectWorktree?: () => void;
  onApplyWorktree?: () => void;
  onHandoff?: () => void;
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
  onToggleCollapsed,
  kind = 'session',
  sectionName = null,
  parentTitle = null,
  provider = null,
  accountDisplay = null,
  path = null,
  worktreeBranch = null,
  worktreeBusy = false,
  onInspectWorktree,
  onApplyWorktree,
  onHandoff,
}: SessionDetailsProps) {
  const contextSummary = contextLabel(context);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTabId>('context');

  if (collapsed) return null;

  const tabs = inspectorTabs({ subagents, worktreeBranch });
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
        <button
          type="button"
          className="icon-btn session-details-collapse"
          aria-label="Minimizar detalhes da sessão"
          data-tooltip="Minimizar detalhes da sessão"
          onClick={onToggleCollapsed}
        >
          <PanelRightCloseIcon size={15} />
        </button>
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
                    onClick={onInspectWorktree}
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
