import { useState } from 'react';
import type { Session, VerificationCheck } from '@inova/core/types';
import type { AccountView, ProjectView } from '../shared/api';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME, accountDisplayName } from './provider-meta';
import { relativeTime } from './relative-time';
import { STATUS_TEXT, UsageSection, type UsageState } from './UsageBar';
import './session.css';

interface SessionDetailsProps {
  session: Session;
  parentTitle?: string | null;
  project: ProjectView;
  account: AccountView | undefined;
  usage: UsageState | undefined;
  running?: boolean;
  onDetectChecks?: () => void;
  onRunVerification?: () => void;
  onUpdateProjectVerification?: (patch: {
    autoWorktree?: boolean;
    autoVerify?: boolean;
    verificationChecks?: VerificationCheck[];
  }) => void;
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function SessionDetails({
  session,
  parentTitle = null,
  project,
  account,
  usage,
  running = false,
  onDetectChecks,
  onRunVerification,
  onUpdateProjectVerification,
}: SessionDetailsProps) {
  const [newCommand, setNewCommand] = useState('');
  const now = new Date();
  const displayAccount = accountDisplayName({
    label: project.accountLabel,
    email: account?.email ?? project.accountEmail,
  });
  const isSubsession = session.parentId !== null;
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
        <h2 className="section-label">Conta</h2>
        <div className="session-details-account">
          <span className="session-details-account-label" title={displayAccount}>
            <ProviderBadge provider={project.provider} size={18} />
            <span className="session-details-account-text">
              {PROVIDER_NAME[project.provider]} · {displayAccount}
            </span>
          </span>
          {account ? (
            <span className="session-details-status">{STATUS_TEXT[account.status]}</span>
          ) : null}
        </div>
        <UsageSection state={usage} />
      </section>
      <section className="session-details-section">
        <h2 className="section-label">{isSubsession ? 'Subsessão' : 'Sessão'}</h2>
        <dl className="session-details-grid">
          <dt>Tipo</dt>
          <dd>{isSubsession ? 'Subsessão' : 'Sessão'}</dd>
          <dt>Seção</dt>
          <dd className="mono" title={project.path}>
            {folderName(project.path)}
          </dd>
          {isSubsession && parentTitle ? (
            <>
              <dt>Sessão pai</dt>
              <dd title={parentTitle}>{parentTitle}</dd>
            </>
          ) : null}
          {session.worktree ? (
            <>
              <dt>Worktree</dt>
              <dd className="mono" title={session.worktree.path}>
                {session.worktree.branch}
              </dd>
            </>
          ) : null}
          <dt>Provedor</dt>
          <dd className="session-details-provider mono">
            <ProviderBadge provider={project.provider} size={16} />
            {PROVIDER_NAME[project.provider]}
          </dd>
          <dt>Criada</dt>
          <dd className="mono">{relativeTime({ iso: session.createdAt, now })}</dd>
          <dt>Atualizada</dt>
          <dd className="mono">{relativeTime({ iso: session.updatedAt, now })}</dd>
        </dl>
      </section>
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
                    ×
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
