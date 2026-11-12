import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@inova/core/types';
import type { ProjectView } from '../shared/api';
import {
  ArchiveIcon,
  ChatIcon,
  CheckIcon,
  CloseIcon,
  GridIcon,
  KeyIcon,
  PlusIcon,
  TerminalIcon,
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
import type { Tab } from './tabs';
import './sidebar.css';

export type View = 'workspace' | 'agents' | 'accounts' | 'new-session';

export interface SidebarProps {
  view: View;
  onNavigate: (view: View) => void;
  projects: ProjectView[];
  sessions: Record<string, Session[]>;
  activeSessionId: string | null;
  statusOf: (sessionId: string) => SessionStatus;
  loginTabs: Tab[];
  onActivateLogin: (sessionId: string) => void;
  onOpenSession: (session: Session) => void;
  onNewSession: (input: { project: ProjectView; parent: Session | null }) => void;
  onUnbind: (project: ProjectView) => void;
  onRenameSession: (input: { session: Session; title: string }) => void;
  onDeleteSession: (session: Session) => void;
  onArchiveSession: (session: Session) => void;
  onUnarchiveSession: (session: Session) => void;
}

type SessionActions = Pick<
  SidebarProps,
  | 'onOpenSession'
  | 'onNewSession'
  | 'onRenameSession'
  | 'onDeleteSession'
  | 'onArchiveSession'
  | 'onUnarchiveSession'
  | 'statusOf'
>;

const NAV_ITEMS: { view: Exclude<View, 'new-session'>; label: string; icon: ReactNode }[] = [
  { view: 'workspace', label: 'Workspace', icon: <ChatIcon size={16} /> },
  { view: 'agents', label: 'Agentes em paralelo', icon: <GridIcon size={16} /> },
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
  activeSessionId: string | null;
}

function SessionRow(props: SessionRowProps) {
  const { node, project, activeSessionId, ...actions } = props;
  const { onOpenSession, onNewSession, onRenameSession, onDeleteSession, statusOf } = actions;
  const { session, children } = node;
  const [editing, setEditing] = useState(false);
  const archived = session.archivedAt !== null;

  const remove = () => {
    if (confirm(`Apagar a sessão "${session.title}" e suas subsessões?`)) onDeleteSession(session);
  };

  return (
    <li className="session-node">
      <div className={session.id === activeSessionId ? 'session-row active' : 'session-row'}>
        {editing ? (
          <div className="session-main">
            <ProviderBadge provider={project.provider} size={20} />
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
            className="session-main"
            title={session.title}
            onClick={() => onOpenSession(session)}
            onDoubleClick={() => setEditing(true)}
          >
            <ProviderBadge provider={project.provider} size={20} />
            <span className="session-text">
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
            {archived ? (
              <button
                className="session-action"
                aria-label="Desarquivar sessão"
                title="Desarquivar"
                onClick={() => actions.onUnarchiveSession(session)}
              >
                <ArchiveIcon size={14} />
              </button>
            ) : (
              <>
                <button
                  className="session-action"
                  aria-label="Nova subsessão"
                  title="Nova subsessão"
                  onClick={() => onNewSession({ project, parent: session })}
                >
                  <PlusIcon size={14} />
                </button>
                <button
                  className="session-action"
                  aria-label="Arquivar sessão"
                  title="Arquivar"
                  onClick={() => actions.onArchiveSession(session)}
                >
                  <ArchiveIcon size={14} />
                </button>
              </>
            )}
            <button
              className="session-action session-action-danger"
              aria-label={archived ? 'Excluir sessão' : 'Apagar sessão'}
              title={archived ? 'Excluir' : 'Apagar'}
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
  sessions: Session[];
  activeSessionId: string | null;
  onUnbind: SidebarProps['onUnbind'];
}

function ProjectSection(props: ProjectSectionProps) {
  const { project, sessions, activeSessionId, onUnbind, ...actions } = props;
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
          className="project-toggle"
          title={project.path}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span className="section-label">{folderName(project.path)}</span>
          <span className="project-account">{project.accountLabel}</span>
        </button>
        <div className="project-actions">
          <button
            className="session-action"
            aria-label="Nova sessão"
            title="Nova sessão"
            onClick={() => onNewSession({ project, parent: null })}
          >
            <PlusIcon size={14} />
          </button>
          <button
            className="session-action"
            aria-label="Desvincular projeto"
            title="Desvincular projeto"
            onClick={() => {
              const message = `Desvincular o projeto "${folderName(project.path)}"? As sessões dele serão apagadas.`;
              if (confirm(message)) onUnbind(project);
            }}
          >
            <CloseIcon size={14} />
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
  const { view, onNavigate, projects, sessions, activeSessionId, loginTabs } = props;
  return (
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
      <div className="sidebar-projects">
        {projects.length === 0 && (
          <p className="session-empty">Nenhum projeto vinculado. Crie uma sessão para começar.</p>
        )}
        {projects.map((project) => (
          <ProjectSection
            key={project.id}
            project={project}
            sessions={sessions[project.id] ?? []}
            activeSessionId={activeSessionId}
            statusOf={props.statusOf}
            onOpenSession={props.onOpenSession}
            onNewSession={props.onNewSession}
            onRenameSession={props.onRenameSession}
            onDeleteSession={props.onDeleteSession}
            onArchiveSession={props.onArchiveSession}
            onUnarchiveSession={props.onUnarchiveSession}
            onUnbind={props.onUnbind}
          />
        ))}
        {loginTabs.length > 0 && (
          <section className="project-section">
            <div className="project-header">
              <span className="section-label">Logins</span>
            </div>
            <ul className="session-tree">
              {loginTabs.map((tab) => (
                <li key={tab.sessionId} className="session-node">
                  <div
                    className={
                      tab.sessionId === activeSessionId ? 'session-row active' : 'session-row'
                    }
                  >
                    <button
                      className="session-main"
                      onClick={() => props.onActivateLogin(tab.sessionId)}
                    >
                      <TerminalIcon size={16} />
                      <span className="session-text">
                        <span className="session-title">
                          {tab.exited ? `${tab.title} (encerrado)` : tab.title}
                        </span>
                      </span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </nav>
  );
}
