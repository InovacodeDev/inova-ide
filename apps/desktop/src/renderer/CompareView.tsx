import { useEffect, useMemo, useState } from 'react';
import { formatCostUsd } from '@inova/core/cost-tracking';
import { PROVIDER_MODELS, resolveModelConfig } from '@inova/core/models';
import { PROVIDER_MODES } from '@inova/core/modes';
import type { EffortLevel, ExecutionMode, Session, Settings } from '@inova/core/types';
import type { AccountView, ComparisonDiffView, ProjectView } from '../shared/api';
import { INTERRUPTED_MESSAGE, type ChatItem, type ChatState } from './chat-reducer';
import { ConfirmModal } from './ConfirmModal';
import { CompareIcon, PlusIcon, RefreshIcon } from './icons';
import { copyToClipboard } from './clipboard';
import { useI18n } from './I18nContext';
import { Markdown } from './Markdown';
import { modeOptionText } from './mode-picker-state';
import { defaultModelLabel, effortLabel, localizeModelOption } from './model-picker-state';
import { PlatformSelect, type PlatformSelectOption } from './PlatformSelect';
import { ProviderBadge } from './ProviderBadge';
import { accountDisplayName, PROVIDER_NAME } from './provider-meta';
import { sessionStatus, sessionStatusLabel } from './session-status';
import { handleHorizontalTabListKeyDown } from './tablist-nav';
import { ToolCard } from './ToolCard';
import './compare.css';

interface CompareMetrics {
  costUsd: number | null;
  durationMs: number | null;
}

interface CompareSideDraft {
  accountId: string;
  model: string | null;
  effort: EffortLevel | null;
  mode: ExecutionMode | null;
}

interface CompareViewProps {
  projects: readonly ProjectView[];
  accounts: readonly AccountView[];
  sessions: Record<string, Session[]>;
  chats: Record<string, ChatState>;
  compareMetrics: Record<string, CompareMetrics>;
  modelDefaults: Settings['models'] | null;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  onStartComparison: (input: {
    projectId: string;
    prompt: string;
    leftAccountId: string;
    rightAccountId: string;
    leftModel?: string | null;
    leftEffort?: EffortLevel | null;
    leftMode?: ExecutionMode | null;
    rightModel?: string | null;
    rightEffort?: EffortLevel | null;
    rightMode?: ExecutionMode | null;
  }) => Promise<string | null>;
  onGetDiff: (groupId: string) => Promise<ComparisonDiffView | null>;
  onResolveComparison: (input: {
    groupId: string;
    winner: 'left' | 'right';
    cleanupWorktrees: boolean;
  }) => Promise<boolean>;
  onOpenSession: (session: Session) => void;
  onEnsureSessionLoaded?: (sessionId: string) => void;
  onWarn?: (message: string) => void;
}

interface ComparisonGroupEntry {
  groupId: string;
  projectId: string;
  left: Session;
  right: Session;
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function SideConfigCard({
  heading,
  draft,
  accounts,
  modelDefaults,
  onChange,
}: {
  heading: string;
  draft: CompareSideDraft;
  accounts: readonly AccountView[];
  modelDefaults: Settings['models'] | null;
  onChange: (next: CompareSideDraft) => void;
}) {
  const { t, locale } = useI18n();
  const account = accounts.find((item) => item.id === draft.accountId) ?? accounts[0];
  const provider = account?.provider ?? 'claude';
  const catalog = PROVIDER_MODELS[provider];
  const modeCatalog = PROVIDER_MODES[provider];

  const accountOptions: PlatformSelectOption[] = accounts.map((item) => ({
    value: item.id,
    label: accountDisplayName(item),
    description: PROVIDER_NAME[item.provider],
    leading: <ProviderBadge provider={item.provider} size={16} />,
  }));

  const modelOptions: PlatformSelectOption[] = [
    { value: '', label: defaultModelLabel(catalog, locale) },
    ...catalog.models.map((m) => {
      const localized = localizeModelOption(m, locale);
      return {
        value: m.id,
        label: localized.label,
        ...(localized.description ? { description: localized.description } : {}),
      };
    }),
  ];

  const effortOptions: PlatformSelectOption[] = catalog.efforts.map((level) => ({
    value: level,
    label: effortLabel(level, locale),
  }));
  const shownEffort =
    modelDefaults === null
      ? draft.effort
      : resolveModelConfig({
          provider,
          model: draft.model,
          effort: draft.effort,
          settings: { models: modelDefaults },
        }).effort;

  const defaultOption = modeCatalog.options.find((opt) => opt.id === modeCatalog.defaultMode);
  const localizedDefaultMode = defaultOption
    ? modeOptionText(provider, defaultOption, locale)
    : null;
  const modeOptions: PlatformSelectOption[] = [
    {
      value: '',
      label: localizedDefaultMode
        ? t('picker.defaultLabel', { label: localizedDefaultMode.label })
        : t('picker.defaultFallback'),
    },
    ...modeCatalog.options.map((opt) => {
      const localized = modeOptionText(provider, opt, locale);
      return {
        value: opt.id,
        label: localized.label,
        description: localized.description,
      };
    }),
  ];

  return (
    <div className="compare-side-card">
      <div className="compare-side-title">{heading}</div>
      <div className="modal-field">
        <span className="modal-field-label">{t('compare.accountAndProvider')}</span>
        <PlatformSelect
          ariaLabel={t('compare.sideAccountAria', { heading })}
          value={account?.id ?? ''}
          options={accountOptions}
          onChange={(nextId) =>
            onChange({ accountId: nextId, model: null, effort: null, mode: null })
          }
        />
      </div>
      <div className="modal-field">
        <span className="modal-field-label">{t('compare.modelLabel')}</span>
        <PlatformSelect
          ariaLabel={t('compare.sideModelAria', { heading })}
          value={draft.model ?? ''}
          options={modelOptions}
          onChange={(value) => onChange({ ...draft, model: value === '' ? null : value })}
        />
      </div>
      {catalog.efforts.length > 0 ? (
        <div className="modal-field">
          <span className="modal-field-label">{t('compare.effortLabel')}</span>
          <PlatformSelect
            ariaLabel={t('compare.sideEffortAria', { heading })}
            value={shownEffort ?? ''}
            options={effortOptions}
            onChange={(value) => onChange({ ...draft, effort: value as EffortLevel })}
          />
        </div>
      ) : null}
      <div className="modal-field">
        <span className="modal-field-label">{t('compare.modeLabel')}</span>
        <PlatformSelect
          ariaLabel={t('compare.sideModeAria', { heading })}
          value={draft.mode ?? ''}
          options={modeOptions}
          onChange={(value) =>
            onChange({ ...draft, mode: value === '' ? null : (value as ExecutionMode) })
          }
        />
      </div>
    </div>
  );
}

function ComparisonColumn({
  label,
  session,
  account,
  chat,
  metrics,
  onOpenSession,
  onWarn,
}: {
  label: string;
  session: Session;
  account: AccountView | undefined;
  chat: ChatState | undefined;
  metrics: CompareMetrics | undefined;
  onOpenSession: () => void;
  onWarn?: (message: string) => void;
}) {
  const { t, locale } = useI18n();
  const status = sessionStatus(chat);
  const items: readonly ChatItem[] = chat?.items ?? [];
  const lastVerification = [...items]
    .reverse()
    .find(
      (item): item is Extract<ChatItem, { type: 'verification' }> => item.type === 'verification',
    );
  const verificationStatusText = lastVerification
    ? lastVerification.status === 'passed'
      ? t('compare.verify.passed')
      : lastVerification.status === 'failed'
        ? t('compare.verify.failed')
        : lastVerification.status === 'skipped'
          ? t('compare.verify.skipped')
          : t('compare.verify.running')
    : null;

  return (
    <section className="compare-col" aria-label={label}>
      <div className="compare-col-header">
        <div className="compare-col-identity">
          <ProviderBadge provider={account?.provider ?? null} size={18} />
          <span className="compare-col-name">
            {label} · {account ? accountDisplayName(account) : session.title}
          </span>
        </div>
        <div className="compare-col-metrics">
          <span>{sessionStatusLabel(status, locale)}</span>
          <span>{formatDuration(metrics?.durationMs)}</span>
          <span>{formatCostUsd(metrics?.costUsd)}</span>
        </div>
      </div>
      <div className="compare-col-body">
        {items.length === 0 ? (
          <p className="hint">{t('compare.waitingReply')}</p>
        ) : (
          items.map((item) => {
            if (item.type === 'assistant') {
              return <Markdown key={item.id} text={item.text} streaming={item.streaming} />;
            }
            if (item.type === 'tool') {
              return (
                <ToolCard
                  key={item.id}
                  item={item}
                  defaultOpen={false}
                  onCopyText={(text) =>
                    void copyToClipboard({ text, locale, onError: (message) => onWarn?.(message) })
                  }
                />
              );
            }
            if (item.type === 'error') {
              return (
                <div key={item.id} className="chat-error">
                  {item.message === INTERRUPTED_MESSAGE
                    ? t('tool.interruptedMessage')
                    : item.message}
                </div>
              );
            }
            return null;
          })
        )}
      </div>
      <div className="compare-col-footer">
        <span className="hint">
          {verificationStatusText !== null
            ? t('compare.verificationStatus', { status: verificationStatusText })
            : t('compare.noVerification')}
        </span>
        <button type="button" className="btn btn-sm" onClick={onOpenSession}>
          {t('compare.openSession')}
        </button>
      </div>
    </section>
  );
}

export function CompareView(props: CompareViewProps) {
  const { t } = useI18n();
  const {
    projects,
    accounts,
    sessions,
    chats,
    compareMetrics,
    modelDefaults,
    selectedGroupId,
    onSelectGroup,
    onStartComparison,
    onGetDiff,
    onResolveComparison,
    onOpenSession,
    onEnsureSessionLoaded,
    onWarn,
  } = props;

  const groups = useMemo<ComparisonGroupEntry[]>(() => {
    const map = new Map<string, { projectId: string; left?: Session; right?: Session }>();
    for (const list of Object.values(sessions)) {
      for (const session of list) {
        if (!session.comparisonGroupId || session.archivedAt !== null) continue;
        const entry = map.get(session.comparisonGroupId) ?? { projectId: session.projectId };
        if (session.comparisonRole === 'left') entry.left = session;
        else if (session.comparisonRole === 'right') entry.right = session;
        map.set(session.comparisonGroupId, entry);
      }
    }
    const result: ComparisonGroupEntry[] = [];
    for (const [groupId, entry] of map) {
      if (entry.left && entry.right) {
        result.push({ groupId, projectId: entry.projectId, left: entry.left, right: entry.right });
      }
    }
    return result.sort((a, b) => Date.parse(b.left.createdAt) - Date.parse(a.left.createdAt));
  }, [sessions]);

  const activeGroup = groups.find((item) => item.groupId === selectedGroupId) ?? null;

  useEffect(() => {
    if (!activeGroup || !onEnsureSessionLoaded) return;
    onEnsureSessionLoaded(activeGroup.left.id);
    onEnsureSessionLoaded(activeGroup.right.id);
  }, [activeGroup, onEnsureSessionLoaded]);

  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [leftDraft, setLeftDraft] = useState<CompareSideDraft>(() => ({
    accountId: accounts[0]?.id ?? '',
    model: null,
    effort: null,
    mode: null,
  }));
  const [rightDraft, setRightDraft] = useState<CompareSideDraft>(() => ({
    accountId: accounts[1]?.id ?? accounts[0]?.id ?? '',
    model: null,
    effort: null,
    mode: null,
  }));
  const [launching, setLaunching] = useState(false);
  const [tab, setTab] = useState<'stream' | 'diff'>('stream');
  const [diffView, setDiffView] = useState<ComparisonDiffView | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [cleanupWorktrees, setCleanupWorktrees] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [pendingWinner, setPendingWinner] = useState<'left' | 'right' | null>(null);

  const effectiveProjectId = projects.some((p) => p.id === projectId)
    ? projectId
    : (projects[0]?.id ?? '');

  const projectOptions: PlatformSelectOption[] = projects.map((project) => ({
    value: project.id,
    label: folderName(project.path),
    description: project.path,
  }));

  const refreshDiff = async (groupId: string) => {
    setLoadingDiff(true);
    try {
      const next = await onGetDiff(groupId);
      if (next) setDiffView(next);
    } finally {
      setLoadingDiff(false);
    }
  };

  const launchComparison = async () => {
    const trimmed = prompt.trim();
    if (!effectiveProjectId || trimmed === '' || !leftDraft.accountId || !rightDraft.accountId) {
      return;
    }
    setLaunching(true);
    try {
      const groupId = await onStartComparison({
        projectId: effectiveProjectId,
        prompt: trimmed,
        leftAccountId: leftDraft.accountId,
        rightAccountId: rightDraft.accountId,
        ...(leftDraft.model === null ? {} : { leftModel: leftDraft.model }),
        ...(leftDraft.effort === null ? {} : { leftEffort: leftDraft.effort }),
        ...(leftDraft.mode === null ? {} : { leftMode: leftDraft.mode }),
        ...(rightDraft.model === null ? {} : { rightModel: rightDraft.model }),
        ...(rightDraft.effort === null ? {} : { rightEffort: rightDraft.effort }),
        ...(rightDraft.mode === null ? {} : { rightMode: rightDraft.mode }),
      });
      if (groupId) {
        setPrompt('');
        setDiffView(null);
        setTab('stream');
        onSelectGroup(groupId);
      }
    } finally {
      setLaunching(false);
    }
  };

  const resolveWinner = async (winner: 'left' | 'right') => {
    if (!activeGroup) return;
    setResolving(true);
    try {
      const ok = await onResolveComparison({
        groupId: activeGroup.groupId,
        winner,
        cleanupWorktrees,
      });
      if (ok && cleanupWorktrees) {
        onSelectGroup(null);
        setDiffView(null);
      }
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="compare-view">
      <div className="compare-header">
        <div className="compare-title-row">
          <CompareIcon size={18} />
          <h1 className="compare-title">{t('compare.title')}</h1>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setDiffView(null);
            onSelectGroup(null);
          }}
        >
          <PlusIcon size={14} />
          {t('compare.newBtn')}
        </button>
      </div>

      {groups.length > 0 ? (
        <div className="compare-groups">
          {groups.map((group) => (
            <button
              key={group.groupId}
              type="button"
              className={
                activeGroup?.groupId === group.groupId
                  ? 'compare-group-pill active'
                  : 'compare-group-pill'
              }
              onClick={() => {
                setDiffView(null);
                onSelectGroup(group.groupId);
              }}
            >
              {group.left.title} vs {group.right.title}
            </button>
          ))}
        </div>
      ) : null}

      {activeGroup === null ? (
        projects.length === 0 || accounts.length < 2 ? (
          <p className="hint">{t('compare.needAccountsHint')}</p>
        ) : (
          <>
            <div className="modal-field">
              <span className="modal-field-label">{t('compare.projectLabel')}</span>
              <PlatformSelect
                ariaLabel={t('compare.projectAria')}
                value={effectiveProjectId}
                options={projectOptions}
                onChange={setProjectId}
              />
            </div>
            <div className="compare-setup-grid">
              <SideConfigCard
                heading={t('compare.sideA')}
                draft={leftDraft}
                accounts={accounts}
                modelDefaults={modelDefaults}
                onChange={setLeftDraft}
              />
              <SideConfigCard
                heading={t('compare.sideB')}
                draft={rightDraft}
                accounts={accounts}
                modelDefaults={modelDefaults}
                onChange={setRightDraft}
              />
            </div>
            <div className="modal-field">
              <span className="modal-field-label">{t('compare.promptLabel')}</span>
              <textarea
                className="field"
                rows={4}
                value={prompt}
                placeholder={t('compare.promptPlaceholder')}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </div>
            <div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  launching ||
                  prompt.trim() === '' ||
                  leftDraft.accountId === '' ||
                  rightDraft.accountId === '' ||
                  leftDraft.accountId === rightDraft.accountId
                }
                onClick={() => void launchComparison()}
              >
                {launching ? t('compare.launching') : t('compare.runParallel')}
              </button>
            </div>
          </>
        )
      ) : (
        <>
          <div className="compare-tabs">
            <div
              className="compare-tablist"
              role="tablist"
              aria-label={t('compare.viewAria')}
              onKeyDown={(event) =>
                handleHorizontalTabListKeyDown({
                  event,
                  ids: ['stream', 'diff'] as const,
                  activeId: tab,
                  onSelect: (nextTab) => {
                    setTab(nextTab);
                    if (
                      nextTab === 'diff' &&
                      !diffView &&
                      activeGroup.left.worktree &&
                      activeGroup.right.worktree
                    ) {
                      void refreshDiff(activeGroup.groupId);
                    }
                  },
                })
              }
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'stream'}
                tabIndex={tab === 'stream' ? 0 : -1}
                className={tab === 'stream' ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                onClick={() => setTab('stream')}
              >
                {t('compare.tabStream')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'diff'}
                tabIndex={tab === 'diff' ? 0 : -1}
                className={tab === 'diff' ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                onClick={() => {
                  setTab('diff');
                  if (!diffView && activeGroup.left.worktree && activeGroup.right.worktree) {
                    void refreshDiff(activeGroup.groupId);
                  }
                }}
              >
                {t('compare.tabDiff')}
              </button>
            </div>
            {tab === 'diff' && activeGroup.left.worktree && activeGroup.right.worktree ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={loadingDiff}
                onClick={() => void refreshDiff(activeGroup.groupId)}
              >
                <RefreshIcon size={13} />
                {loadingDiff ? t('compare.refreshingDiff') : t('compare.refreshDiff')}
              </button>
            ) : null}
          </div>

          {tab === 'stream' ? (
            <div className="compare-split-columns">
              <ComparisonColumn
                label={t('compare.sideA')}
                session={activeGroup.left}
                account={accounts.find((item) => item.id === activeGroup.left.accountIdOverride)}
                chat={chats[activeGroup.left.id]}
                metrics={compareMetrics[activeGroup.left.id]}
                onOpenSession={() => onOpenSession(activeGroup.left)}
                onWarn={onWarn}
              />
              <ComparisonColumn
                label={t('compare.sideB')}
                session={activeGroup.right}
                account={accounts.find((item) => item.id === activeGroup.right.accountIdOverride)}
                chat={chats[activeGroup.right.id]}
                metrics={compareMetrics[activeGroup.right.id]}
                onOpenSession={() => onOpenSession(activeGroup.right)}
                onWarn={onWarn}
              />
            </div>
          ) : (
            <div className="compare-diff-list">
              {loadingDiff && !diffView ? (
                <p className="hint">{t('compare.computingDiffs')}</p>
              ) : !diffView && (!activeGroup.left.worktree || !activeGroup.right.worktree) ? (
                <p className="hint">{t('compare.worktreesCleaned')}</p>
              ) : !diffView || diffView.files.length === 0 ? (
                <p className="hint">{t('compare.noSideChanges')}</p>
              ) : (
                diffView.files.map((entry) => (
                  <div key={entry.path} className="compare-diff-file">
                    <div className="compare-diff-file-head mono">{entry.path}</div>
                    <div className="compare-diff-panes">
                      <pre className="compare-diff-pane mono">
                        {entry.leftChanged ? entry.leftDiff : t('compare.noLeftChanges')}
                      </pre>
                      <pre className="compare-diff-pane mono">
                        {entry.rightChanged ? entry.rightDiff : t('compare.noRightChanges')}
                      </pre>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeGroup.left.worktree && activeGroup.right.worktree ? (
            <div className="compare-resolve-bar">
              <label className="modal-check">
                <input
                  type="checkbox"
                  checked={cleanupWorktrees}
                  onChange={(event) => setCleanupWorktrees(event.target.checked)}
                />
                <span>{t('compare.cleanupCheckbox')}</span>
              </label>
              <div className="compare-resolve-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    resolving ||
                    Boolean(chats[activeGroup.left.id]?.running) ||
                    Boolean(chats[activeGroup.right.id]?.running)
                  }
                  onClick={() => {
                    if (cleanupWorktrees) {
                      setPendingWinner('left');
                      return;
                    }
                    void resolveWinner('left');
                  }}
                >
                  {t('compare.applyLeft')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    resolving ||
                    Boolean(chats[activeGroup.left.id]?.running) ||
                    Boolean(chats[activeGroup.right.id]?.running)
                  }
                  onClick={() => {
                    if (cleanupWorktrees) {
                      setPendingWinner('right');
                      return;
                    }
                    void resolveWinner('right');
                  }}
                >
                  {t('compare.applyRight')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
      {pendingWinner ? (
        <ConfirmModal
          title={t('compare.confirmTitle')}
          description={t('compare.confirmDesc', {
            side: pendingWinner === 'left' ? t('compare.sideA') : t('compare.sideB'),
          })}
          confirmLabel={t('compare.confirmBtn')}
          danger
          onCancel={() => setPendingWinner(null)}
          onConfirm={() => {
            const side = pendingWinner;
            setPendingWinner(null);
            void resolveWinner(side);
          }}
        />
      ) : null}
    </div>
  );
}
