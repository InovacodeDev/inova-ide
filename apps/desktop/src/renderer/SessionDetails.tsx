import { useMemo, useState } from 'react';
import type { SubagentSnapshot, SubagentStatus } from '@inova/core/chat-types';
import { formatCostUsd, type TurnUsageEntry } from '@inova/core/cost-tracking';
import { MAX_PINNED_MEMORY_CHARS } from '@inova/core/handoff';
import type { ProviderId, SessionUsageTotals } from '@inova/core/types';
import type { ContextInfo } from './chat-reducer';
import {
  categoryLabel,
  isReservedCategory,
  rowParts,
  sectionLabel,
  sectionTotal,
  sortedRows,
} from './context-breakdown';
import {
  parseUnifiedGitDiff,
  splitFilePath,
  STATUS_BADGE,
  summarizeGitChanges,
} from './git-diff-presentation';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  GitBranchIcon,
  RefreshIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SwitchIcon,
} from './icons';
import { useI18n } from './I18nContext';
import { inspectorTabs, subagentSummaryCounts, type InspectorTabId } from './inspector-state';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME } from './provider-meta';
import { handleHorizontalTabListKeyDown } from './tablist-nav';
import { contextLabel, formatTokens } from './token-format';
import { useContextBreakdown } from './useContextBreakdown';
import { useSessionGitStatus } from './useSessionGitStatus';
import './session.css';

function PinnedMemoryField({
  title,
  placeholder,
  value,
  disabled = false,
  onSave,
}: {
  title: string;
  placeholder: string;
  value: string | null;
  disabled?: boolean;
  onSave: (value: string | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const initialValue = value ?? '';
  const [draft, setDraft] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const normalizedDraft = draft.trim();
  const normalizedSaved = initialValue.trim();
  const dirty = normalizedDraft !== normalizedSaved;
  const remaining = MAX_PINNED_MEMORY_CHARS - draft.length;

  const commit = async (next: string | null) => {
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pinned-memory-card">
      <div className="pinned-memory-head">
        <span className="section-label">{title}</span>
        <span className="pinned-memory-count mono">{remaining}</span>
      </div>
      <textarea
        className="field pinned-memory-textarea"
        rows={3}
        maxLength={MAX_PINNED_MEMORY_CHARS}
        value={draft}
        disabled={saving || disabled}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="pinned-memory-actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={saving || disabled || (normalizedDraft === '' && normalizedSaved === '')}
          onClick={() => {
            setDraft('');
            if (normalizedSaved !== '') {
              void commit(null);
            }
          }}
        >
          {t('details.clearMemory')}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={saving || disabled || !dirty}
          onClick={() => void commit(normalizedDraft === '' ? null : normalizedDraft)}
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  );
}

function ContextBreakdownPanel({
  sessionId,
  usedTokens,
}: {
  sessionId: string;
  usedTokens: number | null;
}) {
  const { t, locale } = useI18n();
  const { breakdown, error, loading, refresh } = useContextBreakdown({
    sessionId,
    usedTokens,
    locale,
  });
  const maxTokens = Math.max(1, ...(breakdown?.categories.map((item) => item.tokens) ?? []));

  return (
    <div className="context-breakdown" aria-busy={loading}>
      <div className="context-breakdown-head">
        <span className="context-breakdown-status">
          {loading ? t('common.updating') : breakdown ? t('details.contextStatusEstimate') : ''}
        </span>
        <button
          type="button"
          className="icon-btn context-breakdown-refresh"
          aria-label={t('details.refreshContextAria')}
          data-tooltip={t('details.refreshContextAria')}
          disabled={loading}
          onClick={refresh}
        >
          <RefreshIcon size={13} />
        </button>
      </div>
      {error !== null ? <p className="context-breakdown-error">{error}</p> : null}
      {breakdown === null && error === null && loading ? (
        <p className="context-breakdown-empty">{t('details.contextReading')}</p>
      ) : null}
      {breakdown !== null ? (
        <>
          <ul className="context-breakdown-categories">
            {breakdown.categories.map((category) => (
              <li
                key={category.name}
                className="context-breakdown-category"
                data-reserved={isReservedCategory(category.name)}
              >
                <div className="context-breakdown-row">
                  <span className="context-breakdown-name">
                    {categoryLabel(category.name, locale)}
                  </span>
                  <span className="context-breakdown-tokens mono">
                    {formatTokens(category.tokens)}
                    {category.percent !== null ? ` · ${category.percent}%` : ''}
                  </span>
                </div>
                {isReservedCategory(category.name) ? null : (
                  <div className="context-breakdown-bar">
                    <div
                      className="context-breakdown-bar-fill"
                      style={{ width: `${(category.tokens / maxTokens) * 100}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {breakdown.sections.map((section, sectionIndex) => (
            <details key={`${sectionIndex}-${section.title}`} className="context-breakdown-section">
              <summary className="context-breakdown-row">
                <span className="context-breakdown-name">
                  {t('details.contextSectionCount', {
                    label: sectionLabel(section.title, locale),
                    count: section.rows.length,
                  })}
                </span>
                <span className="context-breakdown-tokens mono">
                  {formatTokens(sectionTotal(section))}
                </span>
              </summary>
              <ul className="context-breakdown-items">
                {sortedRows(section).map((row, rowIndex) => {
                  const { name, detail } = rowParts(row);
                  return (
                    <li key={`${rowIndex}-${name}`} className="context-breakdown-item">
                      <div className="context-breakdown-row">
                        <span className="context-breakdown-name" title={name}>
                          {name}
                        </span>
                        <span className="context-breakdown-tokens mono">
                          {row.tokens === null ? '—' : formatTokens(row.tokens)}
                        </span>
                      </div>
                      {detail ? (
                        <span className="context-breakdown-detail mono" title={detail}>
                          {detail}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </>
      ) : null}
    </div>
  );
}

function formatUsageCost(
  totals: SessionUsageTotals | null | undefined,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (!totals || totals.turns === 0) return '$0.0000';
  if (totals.costTurns === 0) return '—';
  const base = formatCostUsd(totals.costUsd);
  return totals.costTurns < totals.turns ? t('details.partialCost', { cost: base }) : base;
}

function SessionUsagePanel({
  sessionUsage,
  projectUsage,
  projectSessionCount = 0,
  turnUsages = [],
}: {
  sessionUsage: SessionUsageTotals | null | undefined;
  projectUsage: SessionUsageTotals | null | undefined;
  projectSessionCount?: number;
  turnUsages?: readonly TurnUsageEntry[];
}) {
  const { t } = useI18n();
  const sessionTotals = sessionUsage ?? {
    costUsd: 0,
    costTurns: 0,
    turns: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const projectTotals = projectUsage ?? sessionTotals;

  return (
    <div className="session-usage-panel">
      <div className="session-usage-block">
        <div className="session-usage-head">
          <span className="session-details-subhead">{t('details.sessionCostsTitle')}</span>
          <span className="session-usage-cost mono">{formatUsageCost(sessionTotals, t)}</span>
        </div>
        <dl className="session-usage-grid mono">
          <div>
            <dt>{t('details.inputLabel')}</dt>
            <dd>{formatTokens(sessionTotals.inputTokens)}</dd>
          </div>
          <div>
            <dt>{t('details.outputLabel')}</dt>
            <dd>{formatTokens(sessionTotals.outputTokens)}</dd>
          </div>
          <div>
            <dt>{t('details.cacheReadLabel')}</dt>
            <dd>{formatTokens(sessionTotals.cacheReadTokens)}</dd>
          </div>
          <div>
            <dt>{t('details.cacheWriteLabel')}</dt>
            <dd>{formatTokens(sessionTotals.cacheWriteTokens)}</dd>
          </div>
        </dl>
      </div>
      <div className="session-usage-block">
        <div className="session-usage-head">
          <span className="session-details-subhead">
            {t('details.projectTotalTitle', {
              count: projectSessionCount,
              unit:
                projectSessionCount === 1
                  ? t('details.sessionSingular')
                  : t('details.sessionPlural'),
            })}
          </span>
          <span className="session-usage-cost mono">{formatUsageCost(projectTotals, t)}</span>
        </div>
        <div className="session-usage-project-tokens mono">
          <span>
            {t('details.inShort')}: {formatTokens(projectTotals.inputTokens)}
          </span>
          <span>
            {t('details.outShort')}: {formatTokens(projectTotals.outputTokens)}
          </span>
          <span>
            Cache: {formatTokens(projectTotals.cacheReadTokens + projectTotals.cacheWriteTokens)}
          </span>
        </div>
      </div>
      {turnUsages.length > 0 ? (
        <details className="context-breakdown-section">
          <summary className="context-breakdown-row">
            <span className="context-breakdown-name">
              {t('details.byTurnTitle', { count: turnUsages.length })}
            </span>
            <span className="context-breakdown-tokens mono">
              {t('details.turnsCount', { count: sessionTotals.turns })}
            </span>
          </summary>
          <ul className="session-usage-turns">
            {turnUsages.map((turn, index) => (
              <li key={`${turn.turnIndex}-${index}`} className="session-usage-turn-row">
                <div className="session-usage-turn-top">
                  <span className="session-usage-turn-title">
                    #{index + 1} {turn.promptPreview || t('details.untitledTurn')}
                  </span>
                  <span className="mono">{formatCostUsd(turn.costUsd)}</span>
                </div>
                <div className="session-usage-turn-meta mono">
                  <span>
                    {t('details.inShort')} {formatTokens(turn.inputTokens)}
                  </span>
                  <span>
                    {t('details.outShort')} {formatTokens(turn.outputTokens)}
                  </span>
                  <span>Cache {formatTokens(turn.cacheReadTokens + turn.cacheWriteTokens)}</span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

interface SessionDetailsProps {
  sessionId: string;
  subagents?: SubagentSnapshot[];
  context?: ContextInfo;
  sessionUsage?: SessionUsageTotals | null;
  projectUsage?: SessionUsageTotals | null;
  projectSessionCount?: number;
  turnUsages?: readonly TurnUsageEntry[];
  collapsed: boolean;
  kind?: 'session' | 'subsession';
  sectionName?: string | null;
  parentTitle?: string | null;
  provider?: ProviderId | null;
  accountDisplay?: string | null;
  path?: string | null;
  worktreeBranch?: string | null;
  worktreeBusy?: boolean;
  running?: boolean;
  gitRevision?: number;
  onInspectWorktree?: (initialFilePath?: string) => void;
  onApplyWorktree?: () => void;
  onRevertFiles?: (files: string[]) => Promise<boolean> | void;
  onReviewDiff?: () => void;
  reviewBusy?: boolean;
  onHandoff?: () => void;
  projectPinnedMemory?: string | null;
  sessionPinnedMemory?: string | null;
  pinnedMemoryDisabled?: boolean;
  onSaveProjectPinnedMemory?: (value: string | null) => Promise<void>;
  onSaveSessionPinnedMemory?: (value: string | null) => Promise<void>;
}

export function SessionDetails({
  sessionId,
  subagents = [],
  context,
  sessionUsage,
  projectUsage,
  projectSessionCount,
  turnUsages,
  collapsed,
  kind = 'session',
  sectionName = null,
  parentTitle = null,
  provider = null,
  accountDisplay = null,
  path = null,
  worktreeBranch = null,
  worktreeBusy = false,
  running = false,
  gitRevision = 0,
  onInspectWorktree,
  onApplyWorktree,
  onRevertFiles,
  onReviewDiff,
  reviewBusy = false,
  onHandoff,
  projectPinnedMemory = null,
  sessionPinnedMemory = null,
  pinnedMemoryDisabled = false,
  onSaveProjectPinnedMemory,
  onSaveSessionPinnedMemory,
}: SessionDetailsProps) {
  const { t, locale } = useI18n();
  const contextSummary = contextLabel(context);
  const hasPinnedMemory = Boolean(sessionPinnedMemory?.trim() || projectPinnedMemory?.trim());
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [pinnedMemoryOpen, setPinnedMemoryOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTabId>('context');
  const gitStatus = useSessionGitStatus({
    sessionId,
    running,
    revision: gitRevision,
    locale,
  });
  const gitFiles = useMemo(
    () =>
      parseUnifiedGitDiff({
        diff: gitStatus.status?.diff ?? '',
        changedFiles: gitStatus.status?.changedFiles ?? [],
      }),
    [gitStatus.status],
  );
  const gitSummary = useMemo(() => summarizeGitChanges(gitFiles), [gitFiles]);

  if (collapsed) return null;

  const tabs = inspectorTabs({
    subagents,
    worktreeBranch,
    changedFilesCount: gitFiles.length,
    locale,
  });
  const counts = subagentSummaryCounts(subagents);
  const hasActions = Boolean(
    (worktreeBranch && (onInspectWorktree || onApplyWorktree)) || onHandoff,
  );
  const subagentStatusLabel = (status: SubagentStatus): string => {
    if (status === 'running') return t('details.subagent.running');
    if (status === 'done') return t('details.subagent.done');
    return t('details.subagent.error');
  };

  return (
    <aside className="session-details" aria-label={t('details.asideAria')}>
      <div className="session-details-top">
        <div
          className="session-details-tabs"
          role="tablist"
          aria-label={t('details.tabsAria')}
          onKeyDown={(event) =>
            handleHorizontalTabListKeyDown({
              event,
              ids: tabs.map((tab) => tab.id),
              activeId: activeTab,
              onSelect: setActiveTab,
            })
          }
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={
                activeTab === tab.id ? 'session-details-tab active' : 'session-details-tab'
              }
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.label}</span>
              {tab.badge ? <span className="session-details-tab-badge">{tab.badge}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="session-details-body">
        {activeTab === 'context' ? (
          <section className="session-details-section">
            <div className="session-details-context">
              <span className="mono">{contextSummary.text}</span>
              {contextSummary.percent !== null ? (
                <div
                  className="session-details-meter"
                  role="progressbar"
                  aria-label={t('details.contextUsageAria')}
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
            <button
              type="button"
              className="context-breakdown-toggle"
              aria-expanded={breakdownOpen}
              onClick={() => setBreakdownOpen((open) => !open)}
            >
              {breakdownOpen ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
              {t('details.whatUsedContext')}
            </button>
            {breakdownOpen ? (
              <ContextBreakdownPanel
                key={sessionId}
                sessionId={sessionId}
                usedTokens={context?.usedTokens ?? null}
              />
            ) : null}
            <SessionUsagePanel
              sessionUsage={sessionUsage}
              projectUsage={projectUsage}
              projectSessionCount={projectSessionCount}
              turnUsages={turnUsages}
            />
            {onSaveSessionPinnedMemory || onSaveProjectPinnedMemory ? (
              <div className="pinned-memory-section">
                <button
                  type="button"
                  className="context-breakdown-toggle pinned-memory-toggle"
                  aria-expanded={pinnedMemoryOpen}
                  onClick={() => setPinnedMemoryOpen((open) => !open)}
                >
                  {pinnedMemoryOpen ? (
                    <ChevronDownIcon size={13} />
                  ) : (
                    <ChevronRightIcon size={13} />
                  )}
                  <span>{t('details.pinnedMemory')}</span>
                  {hasPinnedMemory ? (
                    <span className="session-details-tab-badge">
                      {t('details.pinnedMemoryConfigured')}
                    </span>
                  ) : null}
                </button>
                {pinnedMemoryOpen ? (
                  <div className="pinned-memory-group">
                    {onSaveSessionPinnedMemory ? (
                      <PinnedMemoryField
                        key={`session:${sessionId}:${sessionPinnedMemory ?? ''}`}
                        title={t('details.sessionMemoryTitle')}
                        placeholder={t('details.sessionMemoryPlaceholder')}
                        value={sessionPinnedMemory}
                        disabled={pinnedMemoryDisabled}
                        onSave={onSaveSessionPinnedMemory}
                      />
                    ) : null}
                    {onSaveProjectPinnedMemory ? (
                      <PinnedMemoryField
                        key={`project:${path ?? ''}:${projectPinnedMemory ?? ''}`}
                        title={t('details.projectMemoryTitle')}
                        placeholder={t('details.projectMemoryPlaceholder')}
                        value={projectPinnedMemory}
                        disabled={pinnedMemoryDisabled}
                        onSave={onSaveProjectPinnedMemory}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
        {activeTab === 'changes' ? (
          <section className="session-details-section">
            <div className="session-git-head">
              <div className="session-git-summary mono">
                <span>
                  {gitSummary.fileCount}{' '}
                  {gitSummary.fileCount === 1 ? t('details.fileSingular') : t('details.filePlural')}
                </span>
                {gitSummary.addedLines > 0 ? (
                  <span className="chat-diff-stat-add">+{gitSummary.addedLines}</span>
                ) : null}
                {gitSummary.removedLines > 0 ? (
                  <span className="chat-diff-stat-del">-{gitSummary.removedLines}</span>
                ) : null}
              </div>
              <div className="session-git-head-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('details.refreshGitAria')}
                  data-tooltip={t('details.refreshGitAria')}
                  disabled={gitStatus.loading}
                  onClick={gitStatus.refresh}
                >
                  <RefreshIcon size={13} />
                </button>
              </div>
            </div>
            {gitStatus.status?.scope === 'session' ? (
              <div className="session-details-summary">{t('details.sessionScopedGit')}</div>
            ) : null}
            {gitFiles.length > 0 ? (
              <div className="session-git-actions-bar">
                {onInspectWorktree ? (
                  <button type="button" className="btn btn-sm" onClick={() => onInspectWorktree()}>
                    {t('details.inspectWorktreeBtn')}
                  </button>
                ) : null}
                {onReviewDiff ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={worktreeBusy || reviewBusy}
                    onClick={onReviewDiff}
                  >
                    <ShieldCheckIcon size={12} />
                    {reviewBusy ? t('details.reviewStarting') : t('details.reviewWithAi')}
                  </button>
                ) : null}
                {onRevertFiles ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={worktreeBusy}
                    onClick={() => void onRevertFiles(gitFiles.map((file) => file.path))}
                  >
                    <RotateCcwIcon size={12} />
                    {t('details.revertAllBtn')}
                  </button>
                ) : null}
              </div>
            ) : null}
            {gitStatus.error ? <p className="context-breakdown-error">{gitStatus.error}</p> : null}
            {gitFiles.length === 0 ? (
              <p className="session-details-empty">
                {gitStatus.loading ? t('details.readingGit') : t('details.noGitChanges')}
              </p>
            ) : (
              <ul className="session-git-list">
                {gitFiles.map((file) => {
                  const { fileName, dirName } = splitFilePath(file.path);
                  return (
                    <li key={file.path} className="session-git-item">
                      <button
                        type="button"
                        className="session-git-item-main"
                        title={file.path}
                        onClick={() => onInspectWorktree?.(file.path)}
                      >
                        <span className="session-git-badge" data-status={file.status}>
                          {STATUS_BADGE[file.status]}
                        </span>
                        <span className="session-git-item-names">
                          <span className="session-git-item-name mono">{fileName}</span>
                          {dirName ? (
                            <span className="session-git-item-dir mono">{dirName}</span>
                          ) : null}
                        </span>
                        <span className="session-git-item-stats mono">
                          {file.addedLines > 0 ? (
                            <span className="chat-diff-stat-add">+{file.addedLines}</span>
                          ) : null}
                          {file.removedLines > 0 ? (
                            <span className="chat-diff-stat-del">-{file.removedLines}</span>
                          ) : null}
                        </span>
                      </button>
                      {onRevertFiles ? (
                        <button
                          type="button"
                          className="icon-btn session-git-item-revert"
                          aria-label={t('details.revertFileAria', { path: file.path })}
                          data-tooltip={t('details.revertFileTooltip')}
                          disabled={worktreeBusy}
                          onClick={() => void onRevertFiles([file.path])}
                        >
                          <RotateCcwIcon size={12} />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
        {activeTab === 'subagents' ? (
          <section className="session-details-section">
            {subagents.length === 0 ? (
              <p className="session-details-empty">{t('details.noSubagents')}</p>
            ) : (
              <>
                <div className="session-details-summary mono">
                  {counts.total}{' '}
                  {counts.total === 1 ? t('details.subagentSingular') : t('details.subagentPlural')}{' '}
                  · {formatTokens(counts.totalTokens)} {t('details.totalShort')}
                </div>
                <ul className="session-details-subagents">
                  {subagents.map((agent) => (
                    <li key={agent.toolId} className="session-details-subagent">
                      <div className="session-details-subagent-head">
                        <span className="session-details-subagent-name" title={agent.description}>
                          {agent.description}
                        </span>
                        <span
                          className="session-details-subagent-status"
                          data-status={agent.status}
                        >
                          {subagentStatusLabel(agent.status)}
                        </span>
                      </div>
                      <div className="session-details-subagent-meta mono">
                        {[agent.agentType, agent.model].filter(Boolean).join(' · ') || '—'}
                      </div>
                      <div className="session-details-subagent-meta mono">
                        {t('details.subagentMetaTokens', {
                          inCount: formatTokens(agent.inputTokens),
                          outCount: formatTokens(agent.outputTokens),
                          totalCount: formatTokens(agent.totalTokens),
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ) : null}
        {activeTab === 'session' ? (
          <section className="session-details-section">
            <dl className="session-details-kv">
              <div className="session-details-kv-row">
                <dt className="session-details-kv-label">{t('details.metaType')}</dt>
                <dd className="session-details-kv-value">
                  {kind === 'subsession'
                    ? t('details.metaTypeSubsession')
                    : t('details.metaTypeSession')}
                </dd>
              </div>
              {parentTitle ? (
                <div className="session-details-kv-row">
                  <dt className="session-details-kv-label">{t('details.metaParent')}</dt>
                  <dd className="session-details-kv-value">{parentTitle}</dd>
                </div>
              ) : null}
              <div className="session-details-kv-row">
                <dt className="session-details-kv-label">{t('details.metaProvider')}</dt>
                <dd className="session-details-kv-value">
                  {provider ? (
                    <span className="session-details-provider">
                      <ProviderBadge provider={provider} size={16} />
                      {PROVIDER_NAME[provider]}
                    </span>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div className="session-details-kv-row">
                <dt className="session-details-kv-label">{t('details.metaAccount')}</dt>
                <dd className="session-details-kv-value">{accountDisplay ?? '—'}</dd>
              </div>
              <div className="session-details-kv-row">
                <dt className="session-details-kv-label">{t('details.metaSection')}</dt>
                <dd className="session-details-kv-value">{sectionName ?? '—'}</dd>
              </div>
              <div className="session-details-kv-row">
                <dt className="session-details-kv-label">{t('details.metaDirectory')}</dt>
                <dd className="session-details-kv-value" title={path ?? undefined}>
                  {path ? (
                    <span className="session-details-provider mono">
                      <FolderIcon size={12} />
                      <span>{path}</span>
                    </span>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div className="session-details-kv-row">
                <dt className="session-details-kv-label">{t('details.metaWorktree')}</dt>
                <dd className="session-details-kv-value">
                  {worktreeBranch ? (
                    <span className="session-details-provider mono" title={worktreeBranch}>
                      <GitBranchIcon size={12} />
                      <span>{worktreeBranch}</span>
                    </span>
                  ) : (
                    t('details.metaMainDir')
                  )}
                </dd>
              </div>
            </dl>
            {hasActions ? (
              <div className="session-details-actions">
                {worktreeBranch && onInspectWorktree ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-tooltip={t('details.inspectWorktreeDiffTooltip')}
                    onClick={() => onInspectWorktree()}
                  >
                    {t('details.inspectWorktreeBtn')}
                  </button>
                ) : null}
                {worktreeBranch && onApplyWorktree ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-tooltip={t('details.applyWorktreeBtn')}
                    disabled={worktreeBusy}
                    onClick={onApplyWorktree}
                  >
                    {t('common.apply')}
                  </button>
                ) : null}
                {onHandoff ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-tooltip={t('details.handoffBtn')}
                    onClick={onHandoff}
                  >
                    <SwitchIcon size={13} />
                    {t('details.handoff')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </aside>
  );
}
