import { useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { InboxItem, Session } from '@inova/core/types';
import type { AccountView, ProjectView } from '../shared/api';
import { ConfirmModal } from './ConfirmModal';
import { InboxView } from './InboxView';
import { accountDisplayName } from './provider-meta';
import {
  ArchiveIcon,
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CompareIcon,
  DownloadIcon,
  FolderIcon,
  GridIcon,
  KeyIcon,
  PencilIcon,
  PlusIcon,
  SlidersIcon,
  TrashIcon,
} from './icons';
import { ProviderBadge } from './ProviderBadge';
import { relativeTime } from './relative-time';
import { STATUS_LABEL, type SessionStatus } from './session-status';
import {
  SESSION_LIMIT,
  buildSessionTree,
  splitArchived,
  visibleRoots,
  type SessionNode,
} from './session-tree';
import './sidebar.css';

export type View = 'workspace' | 'agents' | 'compare' | 'accounts' | 'new-session';

export interface SidebarProps {
  view: View;
  onNavigate: (view: View) => void;
  accounts: AccountView[];
  projects: ProjectView[];
  sessions: Record<string, Session[]>;
  inboxItems?: readonly InboxItem[];
  activeSessionId: string | null;
  statusOf: (sessionId: string) => SessionStatus;
  onOpenInboxItem?: (sessionId: string) => void;
  onClearReadInbox?: () => void;
  onOpenProfileSync?: (project: ProjectView) => void;
  onImportSessions?: (project: ProjectView) => void;
  onOpenSession: (session: Session) => void;
  onNewSession: (input: { project: ProjectView; parent: Session | null }) => void;
  onUnbind: (project: ProjectView) => void;
  onRenameSession: (input: { session: Session; title: string }) => void;
  onDeleteSession: (session: Session) => void;
  onRequestArchiveSession: (session: Session) => void;
  onUnarchiveSession: (session: Session) => void;
  inboxRef?: Ref<HTMLElement>;
}

type PendingConfirm =
  { kind: 'delete-session'; session: Session } | { kind: 'unbind-project'; project: ProjectView };

type SessionActions = Pick<
  SidebarProps,
  | 'onOpenSession'
  | 'onNewSession'
  | 'onRenameSession'
  | 'onDeleteSession'
  | 'onUnarchiveSession'
  | 'statusOf'
> & {
  onRequestDelete: (session: Session) => void;
  onRequestArchive: (session: Session) => void;
};

const NAV_ITEMS: { view: Exclude<View, 'new-session'>; label: string; icon: ReactNode }[] = [
  { view: 'workspace', label: 'Workspace', icon: <ChatIcon size={16} /> },
  { view: 'agents', label: 'Agentes em paralelo', icon: <GridIcon size={16} /> },
  { view: 'compare', label: 'Comparar', icon: <CompareIcon size={16} /> },
  { view: 'accounts', label: 'Contas e providers', icon: <KeyIcon size={16} /> },
];

interface TitleEditorProps {
  initial: string;
  onSave: (title: string) => void;
  onCancel: () => void;
}

function TitleEditor({ initial, onSave, onCancel }: TitleEditorProps) {
  const [value, setValue] = useState(initial);
  const settled = useRef(false);

  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const title = value.trim();
    if (save && title !== '' && title !== initial) onSave(title);
    else onCancel();
  };

  return (
    <input
      className="session-rename"
      aria-label="Renomear sessão"
      value={value}
      autoFocus
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
    />
  );
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function StatusLine({ status }: { status: SessionStatus }) {
  if (status === 'idle') return null;
  if (status === 'done') {
    return (
      <span className="session-status session-status-done">
        <CheckIcon size={12} />
        {STATUS_LABEL.done}
      </span>
    );
  }
  const running = status === 'running';
  return (
    <span className={`session-status session-status-${status}`}>
      <span className={running ? 'dot pulse' : 'dot'} />
      {STATUS_LABEL[status]}
    </span>
  );
}

interface SessionRowProps extends SessionActions {
  node: SessionNode;
  project: ProjectView;
  accounts: AccountView[];
  activeSessionId: string | null;
}

function SessionRow(props: SessionRowProps) {
  const { node, project, accounts, activeSessionId, ...actions } = props;
  const {
    onOpenSession,
    onNewSession,
    onRenameSession,
    onRequestDelete,
    onRequestArchive,
    statusOf,
  } = actions;
  const { session, children } = node;
  const [editing, setEditing] = useState(false);
  const archived = session.archivedAt !== null;
  const isSubsession = session.parentId !== null;
  const sessionProvider =
    (session.accountIdOverride
      ? accounts.find((candidate) => candidate.id === session.accountIdOverride)?.provider
      : undefined) ?? project.provider;
  const rowClasses = ['session-row', isSubsession ? 'session-row-sub' : 'session-row-root'];
  if (session.id === activeSessionId) rowClasses.push('active');

  const remove = () => {
    onRequestDelete(session);
  };

  return (
    <li className="session-node">
      <div className={rowClasses.join(' ')}>
        {editing ? (
          <div className="session-main">
            <ProviderBadge provider={sessionProvider} size={isSubsession ? 16 : 20} />
            <TitleEditor
              initial={session.title}
              onSave={(title) => {
                setEditing(false);
                onRenameSession({ session, title });
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="session-main"
            title={session.title}
            onClick={() => onOpenSession(session)}
            onDoubleClick={() => setEditing(true)}
          >
            <ProviderBadge provider={sessionProvider} size={isSubsession ? 16 : 20} />
            <span className="session-text">
              {isSubsession ? <span className="session-kind-sub">Subsessão</span> : null}
              <span className="session-title">{session.title}</span>
              <StatusLine status={statusOf(session.id)} />
            </span>
            <span className="session-time">
              {relativeTime({ iso: session.updatedAt, now: new Date() })}
            </span>
          </button>
        )}
        {!editing && (
          <div className="session-actions">
            <button
              type="button"
              className="session-action"
              aria-label={isSubsession ? 'Renomear subsessão' : 'Renomear sessão'}
              title="Renomear"
              onClick={() => setEditing(true)}
            >
              <PencilIcon size={14} />
            </button>
            {archived ? (
              <button
                type="button"
                className="session-action"
                aria-label={isSubsession ? 'Desarquivar subsessão' : 'Desarquivar sessão'}
                title="Desarquivar"
                onClick={() => actions.onUnarchiveSession(session)}
              >
                <ArchiveIcon size={14} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="session-action"
                  aria-label="Nova subsessão"
                  title="Nova subsessão"
                  onClick={() => onNewSession({ project, parent: session })}
                >
                  <PlusIcon size={14} />
                </button>
                <button
                  type="button"
                  className="session-action"
                  aria-label={isSubsession ? 'Arquivar subsessão' : 'Arquivar sessão'}
                  title="Arquivar"
                  onClick={() => onRequestArchive(session)}
                >
                  <ArchiveIcon size={14} />
                </button>
              </>
            )}
            <button
              type="button"
              className="session-action session-action-danger"
              aria-label={isSubsession ? 'Excluir subsessão' : 'Excluir sessão'}
              title="Excluir"
              onClick={remove}
            >
              <TrashIcon size={14} />
            </button>
          </div>
        )}
      </div>
      {children.length > 0 && (
        <ul className="session-children">
          {children.map((child) => (
            <SessionRow
              key={child.session.id}
              node={child}
              project={project}
              accounts={accounts}
              activeSessionId={activeSessionId}
              {...actions}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface ProjectSectionProps extends SessionActions {
  project: ProjectView;
  accounts: AccountView[];
  accountLabelText: string;
  sessions: Session[];
  activeSessionId: string | null;
  onOpenProfileSync?: (project: ProjectView) => void;
  onImportSessions?: (project: ProjectView) => void;
  onRequestUnbind: (project: ProjectView) => void;
}

function ProjectSection(props: ProjectSectionProps) {
  const {
    project,
    accounts,
    accountLabelText,
    sessions,
    activeSessionId,
    onOpenProfileSync,
    onImportSessions,
    onRequestUnbind,
    ...actions
  } = props;
  const { onNewSession } = actions;
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const split = useMemo(() => splitArchived(sessions), [sessions]);
  const roots = useMemo(() => buildSessionTree(split.active), [split]);
  const archivedRoots = useMemo(() => buildSessionTree(split.archived), [split]);
  const { visible, hiddenCount } = visibleRoots({
    roots,
    limit: SESSION_LIMIT,
    expanded,
    activeSessionId,
  });

  return (
    <section className="project-section">
      <div className="project-header">
        <button
          type="button"
          className="project-toggle"
          title={project.path}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span className="project-chevron">
            {collapsed ? <ChevronRightIcon size={13} /> : <ChevronDownIcon size={13} />}
          </span>
          <span className="project-folder-icon">
            <FolderIcon size={14} />
          </span>
          <span className="project-toggle-text">
            <span className="project-name">{folderName(project.path)}</span>
            <span className="project-account" title={accountLabelText}>
              {accountLabelText}
            </span>
          </span>
        </button>
        <div className="project-actions">
          {onOpenProfileSync ? (
            <button
              type="button"
              className="session-action"
              aria-label="Sincronizar MCPs e regras"
              title="Sincronizar MCPs e regras"
              onClick={() => onOpenProfileSync(project)}
            >
              <SlidersIcon size={14} />
            </button>
          ) : null}
          {onImportSessions ? (
            <button
              type="button"
              className="session-action"
              aria-label="Importar sessões externas"
              title="Importar sessões externas"
              onClick={() => onImportSessions(project)}
            >
              <DownloadIcon size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className="session-action"
            aria-label="Nova sessão na seção"
            title="Nova sessão"
            onClick={() => onNewSession({ project, parent: null })}
          >
            <PlusIcon size={14} />
          </button>
          <button
            type="button"
            className="session-action session-action-danger"
            aria-label="Excluir seção"
            title="Excluir seção"
            onClick={() => onRequestUnbind(project)}
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </div>
      {!collapsed &&
        (roots.length === 0 ? (
          <p className="session-empty">Nenhuma sessão</p>
        ) : (
          <>
            <ul className="session-tree">
              {visible.map((node) => (
                <SessionRow
                  key={node.session.id}
                  node={node}
                  project={project}
                  accounts={accounts}
                  activeSessionId={activeSessionId}
                  {...actions}
                />
              ))}
            </ul>
            {hiddenCount > 0 && (
              <button className="session-more" onClick={() => setExpanded(true)}>
                Mostrar mais ({hiddenCount})
              </button>
            )}
            {expanded && roots.length > SESSION_LIMIT && (
              <button className="session-more" onClick={() => setExpanded(false)}>
                Mostrar menos
              </button>
            )}
          </>
        ))}
      {!collapsed && split.archived.length > 0 && (
        <div className="session-archived">
          <button
            className="session-more"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((value) => !value)}
          >
            Arquivadas ({split.archived.length})
          </button>
          {showArchived && (
            <ul className="session-tree">
              {archivedRoots.map((node) => (
                <SessionRow
                  key={node.session.id}
                  node={node}
                  project={project}
                  accounts={accounts}
                  activeSessionId={activeSessionId}
                  {...actions}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export function Sidebar(props: SidebarProps) {
  const {
    view,
    onNavigate,
    accounts,
    projects,
    sessions,
    inboxItems = [],
    activeSessionId,
    onOpenInboxItem,
    onClearReadInbox,
    inboxRef,
  } = props;
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const emailByLabel = useMemo(
    () => new Map(accounts.map((account) => [account.label, account.email] as const)),
    [accounts],
  );

  return (
    <>
      <nav className="sidebar" aria-label="Principal">
        <button className="btn btn-primary sidebar-new" onClick={() => onNavigate('new-session')}>
          <PlusIcon size={16} />
          Nova sessão
        </button>
        <ul className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <li key={item.view}>
              <button
                className={view === item.view ? 'sidebar-nav-item active' : 'sidebar-nav-item'}
                aria-current={view === item.view ? 'page' : undefined}
                onClick={() => onNavigate(item.view)}
              >
                {item.icon}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        {onOpenInboxItem && onClearReadInbox ? (
          <InboxView
            ref={inboxRef}
            items={inboxItems}
            onOpenItem={onOpenInboxItem}
            onClearRead={onClearReadInbox}
          />
        ) : null}
        <div className="sidebar-projects">
          {projects.length === 0 && (
            <p className="session-empty">Nenhum projeto vinculado. Crie uma sessão para começar.</p>
          )}
          {projects.map((project) => (
            <ProjectSection
              key={project.id}
              project={project}
              accounts={accounts}
              accountLabelText={accountDisplayName({
                label: project.accountLabel,
                email: emailByLabel.get(project.accountLabel) ?? project.accountEmail,
              })}
              sessions={sessions[project.id] ?? []}
              activeSessionId={activeSessionId}
              statusOf={props.statusOf}
              onOpenProfileSync={props.onOpenProfileSync}
              onImportSessions={props.onImportSessions}
              onOpenSession={props.onOpenSession}
              onNewSession={props.onNewSession}
              onRenameSession={props.onRenameSession}
              onDeleteSession={props.onDeleteSession}
              onUnarchiveSession={props.onUnarchiveSession}
              onRequestDelete={(session) => setPendingConfirm({ kind: 'delete-session', session })}
              onRequestArchive={props.onRequestArchiveSession}
              onRequestUnbind={(target) =>
                setPendingConfirm({ kind: 'unbind-project', project: target })
              }
            />
          ))}
        </div>
      </nav>
      {pendingConfirm?.kind === 'delete-session' && (
        <ConfirmModal
          title={pendingConfirm.session.parentId !== null ? 'Excluir subsessão' : 'Excluir sessão'}
          description={
            pendingConfirm.session.parentId !== null
              ? `Excluir a subsessão "${pendingConfirm.session.title}" e todas as subsessões vinculadas?`
              : `Excluir a sessão "${pendingConfirm.session.title}" e todas as subsessões vinculadas?`
          }
          confirmLabel={
            pendingConfirm.session.parentId !== null ? 'Excluir subsessão' : 'Excluir sessão'
          }
          danger
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            const target = pendingConfirm.session;
            setPendingConfirm(null);
            props.onDeleteSession(target);
          }}
        />
      )}
      {pendingConfirm?.kind === 'unbind-project' && (
        <ConfirmModal
          title="Excluir seção"
          description={`Excluir a seção "${folderName(pendingConfirm.project.path)}"? Todas as sessões e subsessões vinculadas a ela serão excluídas da IDE.`}
          confirmLabel="Excluir seção"
          danger
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            const target = pendingConfirm.project;
            setPendingConfirm(null);
            props.onUnbind(target);
          }}
        />
      )}
    </>
  );
}
