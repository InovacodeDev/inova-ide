import type { SubagentSnapshot, SubagentStatus } from '@inova/core/chat-types';
import type { ContextInfo } from './chat-reducer';
import { PanelRightCloseIcon, PanelRightOpenIcon } from './icons';
import { contextLabel, formatTokens } from './token-format';
import './session.css';

interface SessionDetailsProps {
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
  subagents = [],
  context,
  collapsed,
  onToggleCollapsed,
}: SessionDetailsProps) {
  const contextSummary = contextLabel(context);

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
