import { useState } from 'react';
import type { SubagentSnapshot, SubagentStatus } from '@inova/core/chat-types';
import type { VerificationCheck } from '@inova/core/types';
import type { ProjectView } from '../shared/api';
import type { ContextInfo } from './chat-reducer';
import { CloseIcon } from './icons';
import { contextLabel, formatTokens } from './token-format';
import './session.css';

interface SessionDetailsProps {
  project: ProjectView;
  running?: boolean;
  subagents?: SubagentSnapshot[];
  context?: ContextInfo;
  onDetectChecks?: () => void;
  onRunVerification?: () => void;
  onUpdateProjectVerification?: (patch: {
    autoWorktree?: boolean;
    autoVerify?: boolean;
    verificationChecks?: VerificationCheck[];
  }) => void;
}

const SUBAGENT_STATUS_TEXT: Record<SubagentStatus, string> = {
  running: 'rodando',
  done: 'concluído',
  error: 'erro',
};

export function SessionDetails({
  project,
  running = false,
  subagents = [],
  context,
  onDetectChecks,
  onRunVerification,
  onUpdateProjectVerification,
}: SessionDetailsProps) {
  const [newCommand, setNewCommand] = useState('');
  const contextSummary = contextLabel(context);
  const checks = project.verificationChecks ?? [];

  const toggleCheck = (id: string) => {
    if (!onUpdateProjectVerification) return;
    onUpdateProjectVerification({
      verificationChecks: checks.map((check) =>
        check.id === id ? { ...check, enabled: !check.enabled } : check,
      ),
    });
  };

  const removeCheck = (id: string) => {
    if (!onUpdateProjectVerification) return;
    onUpdateProjectVerification({
      verificationChecks: checks.filter((check) => check.id !== id),
    });
  };

  const addCustomCheck = () => {
    const command = newCommand.trim();
    if (!command || !onUpdateProjectVerification) return;
    const id = `custom-${Date.now()}`;
    onUpdateProjectVerification({
      verificationChecks: [...checks, { id, label: command.slice(0, 28), command, enabled: true }],
    });
    setNewCommand('');
  };

  return (
    <aside className="session-details" aria-label="Detalhes da sessão">
      <section className="session-details-section">
        <h2 className="section-label">Contexto</h2>
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
      {onUpdateProjectVerification ? (
        <section className="session-details-section">
          <h2 className="section-label">Automação do projeto</h2>
          <div className="session-details-toggles">
            <label className="session-details-check">
              <input
                type="checkbox"
                checked={project.autoWorktree ?? false}
                onChange={(event) =>
                  onUpdateProjectVerification({ autoWorktree: event.target.checked })
                }
              />
              <span>Worktree por sessão</span>
            </label>
            <label className="session-details-check">
              <input
                type="checkbox"
                checked={project.autoVerify ?? false}
                onChange={(event) =>
                  onUpdateProjectVerification({ autoVerify: event.target.checked })
                }
              />
              <span>Verificar após turno</span>
            </label>
          </div>
          <div className="session-details-actions">
            {onDetectChecks ? (
              <button type="button" className="btn btn-sm" onClick={onDetectChecks}>
                Detectar checks
              </button>
            ) : null}
            {onRunVerification ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={running || !checks.some((c) => c.enabled)}
                onClick={onRunVerification}
              >
                Executar agora
              </button>
            ) : null}
          </div>
          {checks.length > 0 ? (
            <ul className="session-details-checks">
              {checks.map((check) => (
                <li key={check.id} className="session-details-check-row">
                  <label className="session-details-check" title={check.command}>
                    <input
                      type="checkbox"
                      checked={check.enabled}
                      onChange={() => toggleCheck(check.id)}
                    />
                    <span className="mono">{check.label}</span>
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-label={`Remover ${check.label}`}
                    onClick={() => removeCheck(check.id)}
                  >
                    <CloseIcon size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="session-details-add-check">
            <input
              type="text"
              className="field"
              value={newCommand}
              placeholder="Comando (ex: pnpm test)"
              onChange={(event) => setNewCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCustomCheck();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={newCommand.trim() === ''}
              onClick={addCustomCheck}
            >
              Adicionar
            </button>
          </div>
        </section>
      ) : null}
    </aside>
  );
}
