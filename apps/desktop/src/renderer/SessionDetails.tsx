import type { Session } from '@inova/core/types';
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
}: SessionDetailsProps) {
  const now = new Date();
  const displayAccount = accountDisplayName({
    label: project.accountLabel,
    email: account?.email ?? project.accountEmail,
  });
  const isSubsession = session.parentId !== null;
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
    </aside>
  );
}
