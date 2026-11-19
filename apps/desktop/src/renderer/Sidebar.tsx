import { useCallback, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { InboxItem, Session } from '@inova/core/types';
import type { AccountView, ProjectView } from '../shared/api';
import { ConfirmModal } from './ConfirmModal';
import { ContextMenu, useContextMenu, type ContextMenuItem } from './ContextMenu';
import { MENU_WIDTH, type Point } from './context-menu';
import { useI18n } from './I18nContext';
import type { TranslationKey } from './i18n';
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
  EllipsisIcon,
  FolderIcon,
  GridIcon,
  InboxIcon,
  KeyIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  SlidersIcon,
  TrashIcon,
} from './icons';
import { ProviderBadge } from './ProviderBadge';
import { unreadInboxCount } from './inbox-state';
import { relativeTime } from './relative-time';
import { sessionStatusLabel, type SessionStatus } from './session-status';
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
  onOpenProjectSettings?: (project: ProjectView) => void;
  onImportSessions?: (project: ProjectView) => void;
  onOpenSession: (session: Session) => void;
  onNewSession: (input: { project: ProjectView; parent: Session | null }) => void;
  onUnbind: (project: ProjectView) => void;
  onRenameSession: (input: { session: Session; title: string }) => void;
  onDeleteSession: (session: Session) => void;
  onRequestArchiveSession: (session: Session) => void;
  onUnarchiveSession: (session: Session) => void;
  inboxRef?: Ref<HTMLElement>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
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

const NAV_ITEMS: {
  view: Exclude<View, 'new-session'>;
  labelKey: TranslationKey;
  icon: ReactNode;
}[] = [
  { view: 'workspace', labelKey: 'sidebar.nav.workspace', icon: <ChatIcon size={16} /> },
  { view: 'agents', labelKey: 'sidebar.nav.agents', icon: <GridIcon size={16} /> },
  { view: 'compare', labelKey: 'sidebar.nav.compare', icon: <CompareIcon size={16} /> },
  { view: 'accounts', labelKey: 'sidebar.nav.accounts', icon: <KeyIcon size={16} /> },
];

interface SidebarActionMenuProps {
  label: string;
  items: ContextMenuItem[];
}

function SidebarActionMenu({ label, items }: SidebarActionMenuProps) {
  const [anchor, setAnchor] = useState<Point | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const open = anchor !== null;
  const close = useCallback(() => setAnchor(null), []);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ x: rect.right - MENU_WIDTH, y: rect.bottom + 4 });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={open ? 'session-action session-action-open' : 'session-action'}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip={label}
        onClick={toggle}
      >
        <EllipsisIcon size={14} />
      </button>
      {anchor && (
        <ContextMenu
          label={label}
          items={items}
          anchor={anchor}
          focusFirst={false}
          ignoreRef={triggerRef}
          returnFocusTo={triggerRef.current}
          onClose={close}
        />
      )}
    </>
  );
}

interface RowContextMenuProps {
  label: string;
  items: ContextMenuItem[];
  menu: ReturnType<typeof useContextMenu<null>>;
}

function RowContextMenu({ label, items, menu }: RowContextMenuProps) {
  const { state, close } = menu;
  if (!state) return null;
  return (
    <ContextMenu
      label={label}
      items={items}
      anchor={state.anchor}
      focusFirst={state.fromKeyboard}
      returnFocusTo={state.opener}
      onClose={close}
    />
  );
}

interface TitleEditorProps {
  initial: string;
  onSave: (title: string) => void;
  onCancel: () => void;
}

function TitleEditor({ initial, onSave, onCancel }: TitleEditorProps) {
  const { t } = useI18n();
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
      aria-label={t('sidebar.renameInputLabel')}
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
  const { locale } = useI18n();
  if (status === 'idle') return null;
  if (status === 'done') {
    return (
      <span className="session-status session-status-done">
        <CheckIcon size={12} />
        {sessionStatusLabel('done', locale)}
      </span>
    );
  }
  const running = status === 'running';
  return (
    <span className={`session-status session-status-${status}`}>
      <span className={running ? 'dot pulse' : 'dot'} />
      {sessionStatusLabel(status, locale)}
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
  const { locale, t } = useI18n();
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
  const rowMenu = useContextMenu<null>();
  const archived = session.archivedAt !== null;
  const isSubsession = session.parentId !== null;
  const sessionProvider =
    (session.accountIdOverride
      ? accounts.find((candidate) => candidate.id === session.accountIdOverride)?.provider
      : undefined) ?? project.provider;
  const rowClasses = ['session-row', isSubsession ? 'session-row-sub' : 'session-row-root'];
  if (session.id === activeSessionId) rowClasses.push('active');

  const menuItems: ContextMenuItem[] = [
    {
      id: 'rename',
      label: t('sidebar.rename'),
      icon: <PencilIcon size={14} />,
      onSelect: () => setEditing(true),
    },
    ...(archived
      ? [
          {
            id: 'unarchive',
            label: t('sidebar.unarchive'),
            icon: <ArchiveIcon size={14} />,
            onSelect: () => actions.onUnarchiveSession(session),
          },
        ]
      : [
          {
            id: 'new-subsession',
            label: t('sidebar.newSubsession'),
            icon: <PlusIcon size={14} />,
            onSelect: () => onNewSession({ project, parent: session }),
          },
          {
            id: 'archive',
            label: t('sidebar.archive'),
            icon: <ArchiveIcon size={14} />,
            onSelect: () => onRequestArchive(session),
          },
        ]),
    {
      id: 'delete',
      label: t('sidebar.delete'),
      icon: <TrashIcon size={14} />,
      danger: true,
      onSelect: () => onRequestDelete(session),
    },
  ];

  return (
    <li className="session-node">
      <div
        className={rowClasses.join(' ')}
        onContextMenu={editing ? undefined : (event) => rowMenu.open(event, null)}
      >
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
              {isSubsession ? (
                <span className="session-kind-sub">{t('sidebar.subsessionBadge')}</span>
              ) : null}
              <span className="session-title">{session.title}</span>
              <StatusLine status={statusOf(session.id)} />
            </span>
            <span className="session-time">
              {relativeTime({ iso: session.updatedAt, now: new Date(), locale })}
            </span>
          </button>
        )}
        {!editing && (
          <div className="session-actions">
            <SidebarActionMenu label={t('sidebar.sessionActions')} items={menuItems} />
          </div>
        )}
        <RowContextMenu label={t('sidebar.sessionActions')} items={menuItems} menu={rowMenu} />
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
  onOpenProjectSettings?: (project: ProjectView) => void;
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
    onOpenProjectSettings,
    onImportSessions,
    onRequestUnbind,
    ...actions
  } = props;
  const { onNewSession } = actions;
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const headerMenu = useContextMenu<null>();
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

  const projectMenuItems: ContextMenuItem[] = [
    ...(onOpenProjectSettings
      ? [
          {
            id: 'project-settings',
            label: t('sidebar.projectSettings'),
            icon: <SettingsIcon size={14} />,
            onSelect: () => onOpenProjectSettings(project),
          },
        ]
      : []),
    ...(onOpenProfileSync
      ? [
          {
            id: 'profile-sync',
            label: t('sidebar.profileSync'),
            icon: <SlidersIcon size={14} />,
            onSelect: () => onOpenProfileSync(project),
          },
        ]
      : []),
    ...(onImportSessions
      ? [
          {
            id: 'import-sessions',
            label: t('sidebar.importSessions'),
            icon: <DownloadIcon size={14} />,
            onSelect: () => onImportSessions(project),
          },
        ]
      : []),
    {
      id: 'remove-project',
      label: t('sidebar.removeProject'),
      icon: <TrashIcon size={14} />,
      danger: true,
      onSelect: () => onRequestUnbind(project),
    },
  ];

  return (
    <section className="project-section">
      <div className="project-header" onContextMenu={(event) => headerMenu.open(event, null)}>
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
          <button
            type="button"
            className="session-action"
            aria-label={t('sidebar.newSession')}
            data-tooltip={t('sidebar.newSession')}
            onClick={() => onNewSession({ project, parent: null })}
          >
            <PlusIcon size={14} />
          </button>
          <SidebarActionMenu label={t('sidebar.moreActions')} items={projectMenuItems} />
        </div>
        <RowContextMenu
          label={t('sidebar.moreActions')}
          items={projectMenuItems}
          menu={headerMenu}
        />
      </div>
      {!collapsed &&
        (roots.length === 0 ? (
          <p className="session-empty">{t('sidebar.noSessions')}</p>
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
                {t('sidebar.showMore', { count: hiddenCount })}
              </button>
            )}
            {expanded && roots.length > SESSION_LIMIT && (
              <button className="session-more" onClick={() => setExpanded(false)}>
                {t('sidebar.showLess')}
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
            {t('sidebar.archived', { count: split.archived.length })}
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
    collapsed,
    onToggleCollapsed,
  } = props;
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const { t } = useI18n();
  const emailByLabel = useMemo(
    () => new Map(accounts.map((account) => [account.label, account.email] as const)),
    [accounts],
  );

  const unreadCount = unreadInboxCount(inboxItems);
  const unreadUnit = unreadCount === 1 ? t('sidebar.unreadSingular') : t('sidebar.unreadPlural');

  if (collapsed) {
    return (
      <nav className="sidebar-rail" aria-label={t('sidebar.ariaLabel')}>
        <button
          type="button"
          className="sidebar-rail-item"
          aria-label={t('sidebar.newSession')}
          data-tooltip={t('sidebar.newSession')}
          data-shortcut="new-session"
          onClick={() => onNavigate('new-session')}
        >
          <PlusIcon size={16} />
        </button>
        {NAV_ITEMS.map((item) => {
          const itemLabel = t(item.labelKey);
          return (
            <button
              key={item.view}
              type="button"
              className={view === item.view ? 'sidebar-rail-item active' : 'sidebar-rail-item'}
              aria-label={itemLabel}
              aria-current={view === item.view ? 'page' : undefined}
              data-tooltip={itemLabel}
              onClick={() => onNavigate(item.view)}
            >
              {item.icon}
            </button>
          );
        })}
        {unreadCount > 0 ? (
          <button
            type="button"
            className="sidebar-rail-item sidebar-rail-inbox"
            aria-label={t('sidebar.inboxUnreadAria', { count: unreadCount, unit: unreadUnit })}
            data-tooltip={t('sidebar.inboxUnreadTooltip', { count: unreadCount, unit: unreadUnit })}
            onClick={onToggleCollapsed}
          >
            <InboxIcon size={16} />
            <span className="sidebar-rail-badge">{unreadCount}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="sidebar-rail-item"
          aria-label={t('sidebar.expand')}
          data-tooltip={t('sidebar.expand')}
          onClick={onToggleCollapsed}
        >
          <SidebarExpandIcon size={16} />
        </button>
      </nav>
    );
  }

  return (
    <>
      <nav className="sidebar" aria-label={t('sidebar.ariaLabel')}>
        <div className="sidebar-top">
          <button
            className="btn btn-primary sidebar-new"
            data-tooltip={t('sidebar.newSession')}
            data-shortcut="new-session"
            onClick={() => onNavigate('new-session')}
          >
            <PlusIcon size={16} />
            {t('sidebar.newSession')}
          </button>
          <button
            type="button"
            className="sidebar-collapse"
            aria-label={t('sidebar.collapse')}
            data-tooltip={t('sidebar.collapse')}
            onClick={onToggleCollapsed}
          >
            <SidebarCollapseIcon size={16} />
          </button>
        </div>
        <ul className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <li key={item.view}>
              <button
                className={view === item.view ? 'sidebar-nav-item active' : 'sidebar-nav-item'}
                aria-current={view === item.view ? 'page' : undefined}
                onClick={() => onNavigate(item.view)}
              >
                {item.icon}
                {t(item.labelKey)}
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
          {projects.length === 0 && <p className="session-empty">{t('sidebar.noProjects')}</p>}
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
              onOpenProjectSettings={props.onOpenProjectSettings}
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
          title={
            pendingConfirm.session.parentId !== null
              ? t('sidebar.deleteSubsessionTitle')
              : t('sidebar.deleteSessionTitle')
          }
          description={t(
            pendingConfirm.session.parentId !== null
              ? 'sidebar.deleteSubsessionDesc'
              : 'sidebar.deleteSessionDesc',
            { title: pendingConfirm.session.title },
          )}
          confirmLabel={
            pendingConfirm.session.parentId !== null
              ? t('sidebar.deleteSubsessionTitle')
              : t('sidebar.deleteSessionTitle')
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
          title={t('sidebar.removeProjectTitle')}
          description={t('sidebar.removeProjectDesc', {
            name: folderName(pendingConfirm.project.path),
          })}
          confirmLabel={t('sidebar.removeProjectConfirm')}
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
