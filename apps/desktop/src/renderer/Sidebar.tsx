import { useMemo, useRef, useState } from 'react';
import type { Session } from '@inova/core/types';
import type { AccountView, ProjectView } from '../shared/api';
import {
  SESSION_LIMIT,
  buildSessionTree,
  splitArchived,
  visibleRoots,
  type SessionNode,
} from './session-tree';

export interface SidebarProps {
  accounts: AccountView[];
  projects: ProjectView[];
  sessions: Record<string, Session[]>;
  activeSessionId: string | null;
  onOpenSession: (session: Session) => void;
  onNewSession: (input: { project: ProjectView; parent: Session | null }) => void;
  onAddProject: (accountLabel: string) => void;
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
>;

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

interface SessionRowProps extends SessionActions {
  node: SessionNode;
  project: ProjectView;
  activeSessionId: string | null;
}

function SessionRow(props: SessionRowProps) {
  const { node, project, activeSessionId, ...actions } = props;
  const { onOpenSession, onNewSession, onRenameSession, onDeleteSession } = actions;
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
          <TitleEditor
            initial={session.title}
            onSave={(title) => {
              setEditing(false);
              onRenameSession({ session, title });
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <button
            className="session-title"
            title={session.title}
            onClick={() => onOpenSession(session)}
            onDoubleClick={() => setEditing(true)}
          >
            {session.title}
          </button>
        )}
        {archived ? (
          <button
            className="session-archive"
            aria-label="Desarquivar sessão"
            title="Desarquivar"
            onClick={() => actions.onUnarchiveSession(session)}
          >
            Desarquivar
          </button>
        ) : (
          <>
            <button
              className="session-add"
              aria-label="Nova subsessão"
              onClick={() => onNewSession({ project, parent: session })}
            >
              +
            </button>
            <button
              className="session-archive"
              aria-label="Arquivar sessão"
              title="Arquivar"
              onClick={() => actions.onArchiveSession(session)}
            >
              Arquivar
            </button>
          </>
        )}
        <button
          className="session-delete"
          aria-label={archived ? 'Excluir sessão' : 'Apagar sessão'}
          onClick={remove}
        >
          ×
        </button>
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
          <strong>{folderName(project.path)}</strong>
          <small>
            {project.accountLabel} · {project.provider}
          </small>
        </button>
        <button aria-label="Nova sessão" onClick={() => onNewSession({ project, parent: null })}>
          +
        </button>
        <button onClick={() => onUnbind(project)}>Desvincular</button>
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

function AddProjectRow({
  accounts,
  onAddProject,
}: Pick<SidebarProps, 'accounts' | 'onAddProject'>) {
  const [accountLabel, setAccountLabel] = useState('');
  const selected = accountLabel || accounts[0]?.label || '';

  return (
    <div className="row sidebar-add">
      <select
        aria-label="Conta do projeto"
        value={selected}
        onChange={(e) => setAccountLabel(e.target.value)}
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.label}>
            {account.label}
          </option>
        ))}
      </select>
      <button disabled={!selected} onClick={() => onAddProject(selected)}>
        Adicionar projeto
      </button>
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const { accounts, projects, sessions, activeSessionId } = props;
  return (
    <aside className="sidebar">
      <div className="sidebar-projects">
        {projects.map((project) => (
          <ProjectSection
            key={project.id}
            project={project}
            sessions={sessions[project.id] ?? []}
            activeSessionId={activeSessionId}
            onOpenSession={props.onOpenSession}
            onNewSession={props.onNewSession}
            onRenameSession={props.onRenameSession}
            onDeleteSession={props.onDeleteSession}
            onArchiveSession={props.onArchiveSession}
            onUnarchiveSession={props.onUnarchiveSession}
            onUnbind={props.onUnbind}
          />
        ))}
      </div>
      <AddProjectRow accounts={accounts} onAddProject={props.onAddProject} />
    </aside>
  );
}
