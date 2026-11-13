import { useEffect, useMemo, useState } from 'react';
import { EFFORT_LABEL, PROVIDER_MODELS, resolveModelConfig } from '@inova/core/models';
import { PROVIDER_MODES } from '@inova/core/modes';
import type { EffortLevel, ExecutionMode, Session, Settings } from '@inova/core/types';
import type { AccountView, ComparisonDiffView, ProjectView } from '../shared/api';
import type { ChatItem, ChatState } from './chat-reducer';
import { CompareIcon, PlusIcon, RefreshIcon } from './icons';
import { Markdown } from './Markdown';
import { PlatformSelect, type PlatformSelectOption } from './PlatformSelect';
import { ProviderBadge } from './ProviderBadge';
import { accountDisplayName, PROVIDER_NAME } from './provider-meta';
import { STATUS_LABEL, sessionStatus } from './session-status';
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

function formatCost(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return '—';
  return `$${cost.toFixed(4)}`;
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
    { value: '', label: catalog.defaultModelLabel },
    ...catalog.models.map((m) => ({
      value: m.id,
      label: m.label,
      ...(m.description ? { description: m.description } : {}),
    })),
  ];

  const effortOptions: PlatformSelectOption[] = catalog.efforts.map((level) => ({
    value: level,
    label: EFFORT_LABEL[level],
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
  const modeOptions: PlatformSelectOption[] = [
    {
      value: '',
      label: defaultOption ? `Padrão (${defaultOption.label})` : 'Padrão',
    },
    ...modeCatalog.options.map((opt) => ({
      value: opt.id,
      label: opt.label,
      description: opt.description,
    })),
  ];

  return (
    <div className="compare-side-card">
      <div className="compare-side-title">{heading}</div>
      <div className="modal-field">
        <span className="modal-field-label">Conta e provedor</span>
        <PlatformSelect
          ariaLabel={`${heading} conta`}
          value={account?.id ?? ''}
          options={accountOptions}
          onChange={(nextId) =>
            onChange({ accountId: nextId, model: null, effort: null, mode: null })
          }
        />
      </div>
      <div className="modal-field">
        <span className="modal-field-label">Modelo</span>
        <PlatformSelect
          ariaLabel={`${heading} modelo`}
          value={draft.model ?? ''}
          options={modelOptions}
          onChange={(value) => onChange({ ...draft, model: value === '' ? null : value })}
        />
      </div>
      {catalog.efforts.length > 0 ? (
        <div className="modal-field">
          <span className="modal-field-label">Esforço</span>
          <PlatformSelect
            ariaLabel={`${heading} esforço`}
            value={shownEffort ?? ''}
            options={effortOptions}
            onChange={(value) => onChange({ ...draft, effort: value as EffortLevel })}
          />
        </div>
      ) : null}
      <div className="modal-field">
        <span className="modal-field-label">Modo</span>
        <PlatformSelect
          ariaLabel={`${heading} modo`}
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
}: {
  label: string;
  session: Session;
  account: AccountView | undefined;
  chat: ChatState | undefined;
  metrics: CompareMetrics | undefined;
  onOpenSession: () => void;
}) {
  const status = sessionStatus(chat);
  const items: readonly ChatItem[] = chat?.items ?? [];
  const lastVerification = [...items]
    .reverse()
    .find(
      (item): item is Extract<ChatItem, { type: 'verification' }> => item.type === 'verification',
    );

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
          <span>{STATUS_LABEL[status]}</span>
          <span>{formatDuration(metrics?.durationMs)}</span>
          <span>{formatCost(metrics?.costUsd)}</span>
        </div>
      </div>
      <div className="compare-col-body">
        {items.length === 0 ? (
          <p className="hint">Aguardando resposta…</p>
        ) : (
          items.map((item) => {
            if (item.type === 'assistant') {
              return <Markdown key={item.id} text={item.text} streaming={item.streaming} />;
            }
            if (item.type === 'tool') {
              return (
                <div key={item.id} className="chat-tool">
                  <div className="chat-tool-summary">
                    <span className="chat-tool-name">{item.name}</span>
                    <span className="chat-tool-preview">{item.isError ? 'erro' : 'ok'}</span>
                  </div>
                </div>
              );
            }
            if (item.type === 'error') {
              return (
                <div key={item.id} className="chat-error">
                  {item.message}
                </div>
              );
            }
            return null;
          })
        )}
      </div>
      <div className="compare-col-footer">
        <span className="hint">
          {lastVerification
            ? `Verificação: ${
                lastVerification.status === 'passed'
                  ? 'aprovada'
                  : lastVerification.status === 'failed'
                    ? 'falhou'
                    : lastVerification.status === 'skipped'
                      ? 'cancelada'
                      : 'executando'
              }`
            : 'Sem verificação'}
        </span>
        <button type="button" className="btn btn-sm" onClick={onOpenSession}>
          Abrir conversa
        </button>
      </div>
    </section>
  );
}

export function CompareView(props: CompareViewProps) {
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
          <h1 className="compare-title">Execução paralela comparativa</h1>
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
          Nova comparação
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
          <p className="hint">
            Vincule um projeto e cadastre ao menos duas contas diferentes para comparar provedores.
          </p>
        ) : (
          <>
            <div className="modal-field">
              <span className="modal-field-label">Projeto</span>
              <PlatformSelect
                ariaLabel="Projeto para comparação"
                value={effectiveProjectId}
                options={projectOptions}
                onChange={setProjectId}
              />
            </div>
            <div className="compare-setup-grid">
              <SideConfigCard
                heading="Lado A"
                draft={leftDraft}
                accounts={accounts}
                modelDefaults={modelDefaults}
                onChange={setLeftDraft}
              />
              <SideConfigCard
                heading="Lado B"
                draft={rightDraft}
                accounts={accounts}
                modelDefaults={modelDefaults}
                onChange={setRightDraft}
              />
            </div>
            <div className="modal-field">
              <span className="modal-field-label">Prompt único para ambos os worktrees</span>
              <textarea
                className="field"
                rows={4}
                value={prompt}
                placeholder="Descreva a tarefa a executar em paralelo nos dois worktrees…"
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
                {launching ? 'Iniciando…' : 'Executar em paralelo'}
              </button>
            </div>
          </>
        )
      ) : (
        <>
          <div className="compare-tabs">
            <div className="compare-tablist" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'stream'}
                className={tab === 'stream' ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                onClick={() => setTab('stream')}
              >
                Respostas lado a lado
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'diff'}
                className={tab === 'diff' ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                onClick={() => {
                  setTab('diff');
                  if (!diffView && activeGroup.left.worktree && activeGroup.right.worktree) {
                    void refreshDiff(activeGroup.groupId);
                  }
                }}
              >
                Diff lado a lado
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
                {loadingDiff ? 'Atualizando…' : 'Atualizar diff'}
              </button>
            ) : null}
          </div>

          {tab === 'stream' ? (
            <div className="compare-split-columns">
              <ComparisonColumn
                label="Lado A"
                session={activeGroup.left}
                account={accounts.find((item) => item.id === activeGroup.left.accountIdOverride)}
                chat={chats[activeGroup.left.id]}
                metrics={compareMetrics[activeGroup.left.id]}
                onOpenSession={() => onOpenSession(activeGroup.left)}
              />
              <ComparisonColumn
                label="Lado B"
                session={activeGroup.right}
                account={accounts.find((item) => item.id === activeGroup.right.accountIdOverride)}
                chat={chats[activeGroup.right.id]}
                metrics={compareMetrics[activeGroup.right.id]}
                onOpenSession={() => onOpenSession(activeGroup.right)}
              />
            </div>
          ) : (
            <div className="compare-diff-list">
              {loadingDiff && !diffView ? (
                <p className="hint">Calculando diffs nos worktrees…</p>
              ) : !diffView && (!activeGroup.left.worktree || !activeGroup.right.worktree) ? (
                <p className="hint">
                  Os worktrees desta comparação já foram limpos após a aplicação do vencedor.
                </p>
              ) : !diffView || diffView.files.length === 0 ? (
                <p className="hint">Nenhuma alteração registrada ainda em nenhum dos lados.</p>
              ) : (
                diffView.files.map((entry) => (
                  <div key={entry.path} className="compare-diff-file">
                    <div className="compare-diff-file-head mono">{entry.path}</div>
                    <div className="compare-diff-panes">
                      <pre className="compare-diff-pane mono">
                        {entry.leftChanged ? entry.leftDiff : 'Sem alterações no Lado A'}
                      </pre>
                      <pre className="compare-diff-pane mono">
                        {entry.rightChanged ? entry.rightDiff : 'Sem alterações no Lado B'}
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
                <span>Remover worktrees temporários após aplicar vencedor</span>
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
                  onClick={() => void resolveWinner('left')}
                >
                  Aplicar vencedor A
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    resolving ||
                    Boolean(chats[activeGroup.left.id]?.running) ||
                    Boolean(chats[activeGroup.right.id]?.running)
                  }
                  onClick={() => void resolveWinner('right')}
                >
                  Aplicar vencedor B
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
