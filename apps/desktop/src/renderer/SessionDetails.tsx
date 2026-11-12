import type { Session } from '@inova/core/types';
import type { AccountView, ProjectView } from '../shared/api';
import { PROVIDER_NAME } from './provider-meta';
import { relativeTime } from './relative-time';
import { STATUS_TEXT, UsageSection, type UsageState } from './UsageBar';
import './session.css';

interface SessionDetailsProps {
  session: Session;
  project: ProjectView;
  account: AccountView | undefined;
  usage: UsageState | undefined;
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function SessionDetails({ session, project, account, usage }: SessionDetailsProps) {
  const now = new Date();
  return (
    <aside className="session-details" aria-label="Detalhes da sessão">
      <section className="session-details-section">
        <h2 className="section-label">Conta</h2>
        <div className="session-details-account">
          <span>
            {PROVIDER_NAME[project.provider]} · {project.accountLabel}
          </span>
          {account ? (
            <span className="session-details-status">{STATUS_TEXT[account.status]}</span>
          ) : null}
        </div>
        <UsageSection state={usage} />
      </section>
      <section className="session-details-section">
        <h2 className="section-label">Sessão</h2>
        <dl className="session-details-grid">
          <dt>Provedor</dt>
          <dd className="mono">{PROVIDER_NAME[project.provider]}</dd>
          <dt>Pasta</dt>
          <dd className="mono" title={project.path}>
            {folderName(project.path)}
          </dd>
          <dt>Criada</dt>
          <dd className="mono">{relativeTime({ iso: session.createdAt, now })}</dd>
          <dt>Atualizada</dt>
          <dd className="mono">{relativeTime({ iso: session.updatedAt, now })}</dd>
        </dl>
      </section>
    </aside>
  );
}
