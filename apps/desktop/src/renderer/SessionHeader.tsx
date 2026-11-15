import { useRef, useState } from 'react';
import type { ProviderId } from '@inova/core/types';
import {
  CloseIcon,
  GitBranchIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PencilIcon,
  SwitchIcon,
} from './icons';
import { useI18n } from './I18nContext';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME } from './provider-meta';
import { sessionStatusLabel, type SessionStatus } from './session-status';
import './session.css';

interface SessionHeaderProps {
  title: string;
  kind?: 'session' | 'subsession';
  sectionName?: string | null;
  parentTitle?: string | null;
  provider: ProviderId | null;
  accountDisplay: string | null;
  path: string | null;
  worktreeBranch?: string | null;
  worktreeBusy?: boolean;
  status: SessionStatus | null;
  exited?: boolean;
  detailsCollapsed?: boolean;
  onToggleDetails?: () => void;
  onRename?: (title: string) => void;
  onInspectWorktree?: () => void;
  onApplyWorktree?: () => void;
  onHandoff?: () => void;
  onClose: () => void;
}

export function SessionHeader(props: SessionHeaderProps) {
  const {
    title,
    kind = 'session',
    sectionName = null,
    parentTitle = null,
    provider,
    accountDisplay,
    path,
    worktreeBranch = null,
    worktreeBusy = false,
    status,
    exited,
    detailsCollapsed = false,
    onToggleDetails,
    onRename,
    onInspectWorktree,
    onApplyWorktree,
    onHandoff,
    onClose,
  } = props;
  const { locale, t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const settledRef = useRef(false);

  const startEdit = () => {
    settledRef.current = false;
    setDraft(title);
    setEditing(true);
  };

  const finishEdit = (save: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const next = draft.trim();
    setEditing(false);
    if (save && next !== '' && next !== title) onRename?.(next);
  };

  return (
    <div className="session-header">
      <div className="session-header-main">
        {provider ? <ProviderBadge provider={provider} size={18} /> : null}
        {kind === 'subsession' ? (
          <span className="session-kind-pill session-kind-pill-sub">
            {t('sessionHeader.subsessionBadge')}
          </span>
        ) : null}
        {sectionName ? (
          <span className="session-header-crumb" title={path ?? undefined}>
            {sectionName}
          </span>
        ) : null}
        {sectionName ? (
          <span className="session-header-sep" aria-hidden="true">
            /
          </span>
        ) : null}
        {editing ? (
          <input
            className="session-header-rename"
            aria-label={
              kind === 'subsession'
                ? t('sessionHeader.renameSubsession')
                : t('sessionHeader.renameSession')
            }
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => finishEdit(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') finishEdit(true);
              if (event.key === 'Escape') finishEdit(false);
            }}
          />
        ) : (
          <div className="session-header-title-row">
            <h1
              className="session-header-title"
              onDoubleClick={onRename ? startEdit : undefined}
              title={onRename ? t('sessionHeader.doubleClickRename') : undefined}
            >
              {title}
            </h1>
            {onRename ? (
              <button
                type="button"
                className="session-header-edit"
                aria-label={
                  kind === 'subsession'
                    ? t('sessionHeader.renameSubsession')
                    : t('sessionHeader.renameSession')
                }
                data-tooltip={
                  kind === 'subsession'
                    ? t('sessionHeader.renameSubsession')
                    : t('sessionHeader.renameSession')
                }
                onClick={startEdit}
              >
                <PencilIcon size={13} />
              </button>
            ) : null}
          </div>
        )}
        {kind === 'subsession' && parentTitle ? (
          <span
            className="session-header-parent"
            title={`${t('sessionHeader.parentPrefix')} ${parentTitle}`}
          >
            ↳ {parentTitle}
          </span>
        ) : null}
        {exited ? (
          <span className="pill pill-idle">
            <span className="dot" />
            {t('sessionHeader.exitedBadge')}
          </span>
        ) : status !== null && status !== 'idle' ? (
          <span className={`pill pill-${status}`}>
            <span className={status === 'running' ? 'dot pulse' : 'dot'} />
            {sessionStatusLabel(status, locale)}
          </span>
        ) : null}
      </div>
      <div className="session-header-actions">
        {provider ? (
          <span className="session-header-account">
            {PROVIDER_NAME[provider]}
            {accountDisplay !== null ? ` · ${accountDisplay}` : ''}
          </span>
        ) : null}
        {worktreeBranch ? (
          <span className="session-header-worktree">
            <span className="pill session-worktree-pill" title={worktreeBranch}>
              <GitBranchIcon size={13} />
              <span className="mono">{worktreeBranch}</span>
            </span>
            {onInspectWorktree ? (
              <button
                type="button"
                className="btn btn-sm"
                data-tooltip={t('sessionHeader.diffTooltip')}
                onClick={onInspectWorktree}
              >
                {t('sessionHeader.diffBtn')}
              </button>
            ) : null}
            {onApplyWorktree ? (
              <button
                type="button"
                className="btn btn-sm"
                data-tooltip={t('sessionHeader.applyWorktreeTooltip')}
                disabled={worktreeBusy}
                onClick={onApplyWorktree}
              >
                {t('sessionHeader.applyBtn')}
              </button>
            ) : null}
          </span>
        ) : null}
        {onHandoff ? (
          <button
            type="button"
            className="btn btn-sm"
            data-tooltip={t('sessionHeader.handoffTooltip')}
            onClick={onHandoff}
          >
            <SwitchIcon size={13} />
            {t('sessionHeader.handoffBtn')}
          </button>
        ) : null}
        {onToggleDetails ? (
          <button
            type="button"
            className={detailsCollapsed ? 'icon-btn' : 'icon-btn icon-btn-active'}
            aria-label={
              detailsCollapsed ? t('sessionHeader.showDetails') : t('sessionHeader.hideDetails')
            }
            aria-pressed={!detailsCollapsed}
            data-tooltip={
              detailsCollapsed ? t('sessionHeader.showDetails') : t('sessionHeader.hideDetails')
            }
            onClick={onToggleDetails}
          >
            {detailsCollapsed ? (
              <PanelRightOpenIcon size={15} />
            ) : (
              <PanelRightCloseIcon size={15} />
            )}
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn"
          aria-label={
            kind === 'subsession'
              ? t('sessionHeader.closeSubsession')
              : t('sessionHeader.closeTabTooltip')
          }
          data-tooltip={
            kind === 'subsession'
              ? t('sessionHeader.closeSubsession')
              : t('sessionHeader.closeTabTooltip')
          }
          data-shortcut="close-tab"
          onClick={onClose}
        >
          <CloseIcon size={15} />
        </button>
      </div>
    </div>
  );
}
