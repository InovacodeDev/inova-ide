import { useState } from 'react';
import type { SubagentSnapshot, SubagentStatus } from '@inova/core/chat-types';
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
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  RefreshIcon,
} from './icons';
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
}: SessionDetailsProps) {
  const contextSummary = contextLabel(context);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        className="icon-btn session-details-expand"
        aria-label="Mostrar detalhes da sessão"
        data-tooltip="Mostrar detalhes da sessão"
        onClick={onToggleCollapsed}
      >
        <PanelRightOpenIcon size={16} />
      </button>
    );
  }

  return (
    <aside className="session-details" aria-label="Detalhes da sessão">
      <section className="session-details-section">
        <div className="session-details-head">
          <h2 className="section-label">Contexto</h2>
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
      {subagents.length > 0 ? (
        <section className="session-details-section">
          <h2 className="section-label">Subagentes</h2>
          <ul className="session-details-subagents">
            {subagents.map((agent) => (
              <li key={agent.toolId} className="session-details-subagent">
                <div className="session-details-subagent-head">
                  <span className="session-details-subagent-name" title={agent.description}>
                    {agent.description}
                  </span>
                  <span className="session-details-subagent-status" data-status={agent.status}>
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
        </section>
      ) : null}
    </aside>
  );
}
