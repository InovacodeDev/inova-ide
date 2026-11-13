import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ProviderModels } from '@inova/core/models';
import type { EffortLevel, ExecutionMode, ProviderId } from '@inova/core/types';
import type { ProjectCommandView } from '../shared/api';
import type { ChatItem, ChatState } from './chat-reducer';
import { ComposerPopup, type ComposerPopupModel } from './ComposerPopup';
import {
  applyCommandSuggestion,
  applyFileSuggestion,
  detectComposerTrigger,
  filterCommands,
  type ComposerTrigger,
} from './composer-trigger';
import {
  FileIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  SendIcon,
  StopIcon,
  TerminalIcon,
} from './icons';
import { Markdown } from './Markdown';
import { ModelEffortPicker } from './ModelEffortPicker';
import { ModePicker } from './ModePicker';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME } from './provider-meta';
import './chat.css';

export interface ChatViewProps {
  sessionId?: string | null;
  projectId: string | null;
  state: ChatState;
  visible: boolean;
  provider: ProviderId | null;
  accountDisplay: string | null;
  model: string | null;
  effort: EffortLevel | null;
  mode: ExecutionMode | null;
  defaultModes: Partial<Record<ProviderId, ExecutionMode>>;
  inWorktree?: boolean;
  catalog: ProviderModels;
  readOnly?: boolean;
  onChangeModelConfig: (patch: { model?: string | null; effort?: EffortLevel | null }) => void;
  onChangeMode: (mode: ExecutionMode) => void;
  onSetDefaultMode: (mode: ExecutionMode) => void;
  onRestoreCheckpoint?: (input: { ref: string; skippedLargeFiles: string[] }) => void;
  onSend: (prompt: string) => void;
  onCancel: () => void;
}

const NEAR_BOTTOM_PX = 80;
const MAX_COMPOSER_PX = 200;
const FILE_SEARCH_DEBOUNCE_MS = 80;

function firstLine(input: string): string {
  const line = input.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}

const SHELL_TOOL = /bash|shell|exec/i;
const EDIT_TOOL = /edit|write/i;

function ToolIcon({ name }: { name: string }) {
  if (SHELL_TOOL.test(name)) return <TerminalIcon size={16} />;
  if (EDIT_TOOL.test(name)) return <PencilIcon size={16} />;
  return <FileIcon size={16} />;
}

function ToolCard({ item }: { item: Extract<ChatItem, { type: 'tool' }> }) {
  return (
    <details className={item.isError ? 'chat-tool chat-tool-error' : 'chat-tool'}>
      <summary className="chat-tool-summary">
        <span className="chat-tool-icon">
          <ToolIcon name={item.name} />
        </span>
        <span className="chat-tool-name">{item.name}</span>
        <span className="chat-tool-preview">{firstLine(item.input)}</span>
        {item.isError ? <span className="chat-tool-status chat-tool-failed">erro</span> : null}
        {item.output === null ? (
          <span className="chat-tool-status chat-tool-pending">
            <span className="dot pulse" aria-hidden="true" />
            executando
          </span>
        ) : null}
      </summary>
      <div className="chat-tool-body">
        <div className="chat-tool-label">Entrada</div>
        <pre className="chat-tool-pre">{item.input}</pre>
        {item.output === null ? null : (
          <>
            <div className="chat-tool-label">Saída</div>
            <pre className="chat-tool-pre">{item.output}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function buildVerificationRetryPrompt(item: Extract<ChatItem, { type: 'verification' }>): string {
  const failed = item.checks.filter((check) => !check.passed);
  const details = failed
    .map((check) => {
      const exitLabel = check.exitCode === null ? 'sem código' : String(check.exitCode);
      const output = check.output.trim();
      return output
        ? `Comando: ${check.command} (exit ${exitLabel})\n\`\`\`\n${output}\n\`\`\``
        : `Comando: ${check.command} (exit ${exitLabel})`;
    })
    .join('\n\n');
  return `A verificação automática falhou. Corrija os erros abaixo:\n\n${details}`;
}

function VerificationCard({
  item,
  canFix,
  onFix,
}: {
  item: Extract<ChatItem, { type: 'verification' }>;
  canFix: boolean;
  onFix: () => void;
}) {
  const statusLabel =
    item.status === 'running'
      ? 'Executando verificações'
      : item.status === 'passed'
        ? 'Verificação aprovada'
        : 'Verificação falhou';
  return (
    <details
      className={`chat-verification chat-verification-${item.status}`}
      open={item.status === 'failed'}
    >
      <summary className="chat-tool-summary">
        <span className="chat-tool-icon">
          <PlayIcon size={15} />
        </span>
        <span className="chat-tool-name">{statusLabel}</span>
        <span className="chat-tool-preview">
          {item.checks
            .map(
              (c) => `${c.passed ? 'OK' : item.status === 'running' ? '...' : 'ERRO'} ${c.label}`,
            )
            .join(' · ')}
        </span>
      </summary>
      <div className="chat-tool-body">
        {item.checks.map((check) => (
          <div key={check.id} className="chat-verification-item">
            <div className="chat-verification-item-head">
              <span className="chat-tool-name">{check.label}</span>
              <span className="mono chat-verification-cmd">{check.command}</span>
              <span
                className={
                  check.passed
                    ? 'chat-verification-badge chat-verification-ok'
                    : item.status === 'running'
                      ? 'chat-verification-badge'
                      : 'chat-verification-badge chat-verification-fail'
                }
              >
                {item.status === 'running'
                  ? 'executando'
                  : check.passed
                    ? `ok (${check.durationMs}ms)`
                    : `falhou (${check.exitCode ?? 'erro'})`}
              </span>
            </div>
            {check.output.trim() !== '' ? (
              <pre className="chat-tool-pre">{check.output}</pre>
            ) : null}
          </div>
        ))}
        {item.status === 'failed' && canFix ? (
          <div className="chat-verification-actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={onFix}>
              Corrigir falha com o agente
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

interface MessageProps {
  item: ChatItem;
  showAgentLabel: boolean;
  provider: ProviderId | null;
  busy: boolean;
  onRestoreCheckpoint?: (input: { ref: string; skippedLargeFiles: string[] }) => void;
  onFixVerification?: (prompt: string) => void;
}

function AgentLabel({ provider }: { provider: ProviderId | null }) {
  return (
    <div className={`chat-label chat-label-agent chat-label-${provider ?? 'none'}`}>
      <ProviderBadge provider={provider} size={18} />
      {provider ? PROVIDER_NAME[provider] : 'Agente'}
    </div>
  );
}

function Message({
  item,
  showAgentLabel,
  provider,
  busy,
  onRestoreCheckpoint,
  onFixVerification,
}: MessageProps) {
  const label = showAgentLabel ? <AgentLabel provider={provider} /> : null;
  switch (item.type) {
    case 'user':
      return (
        <div className="chat-row">
          <div className="chat-label">Você</div>
          <div className="chat-user-bubble">{item.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className="chat-row chat-row-assistant">
          {label}
          <div>
            <Markdown text={item.text} streaming={item.streaming} />
            {item.streaming ? <span className="chat-caret" aria-hidden="true" /> : null}
          </div>
        </div>
      );
    case 'tool':
      return (
        <div className="chat-row">
          {label}
          <ToolCard item={item} />
        </div>
      );
    case 'checkpoint':
      return (
        <div className="chat-row">
          <div className="chat-checkpoint">
            <span className="chat-checkpoint-info">
              <RotateCcwIcon size={13} />
              <span>Checkpoint antes do turno</span>
              {item.skippedLargeFiles.length > 0 ? (
                <span className="chat-checkpoint-warn" title={item.skippedLargeFiles.join(', ')}>
                  {item.skippedLargeFiles.length} arquivo(s) &gt;10MB preservado(s)
                </span>
              ) : null}
            </span>
            {onRestoreCheckpoint ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() =>
                  onRestoreCheckpoint({
                    ref: item.ref,
                    skippedLargeFiles: item.skippedLargeFiles,
                  })
                }
              >
                Restaurar
              </button>
            ) : null}
          </div>
        </div>
      );
    case 'verification':
      return (
        <div className="chat-row">
          <VerificationCard
            item={item}
            canFix={!busy && Boolean(onFixVerification)}
            onFix={() => onFixVerification?.(buildVerificationRetryPrompt(item))}
          />
        </div>
      );
    case 'error':
      return (
        <div className="chat-row">
          <div className="chat-error" role="alert">
            {item.message}
          </div>
        </div>
      );
  }
}

const ARCHIVED_HINT = 'Sessão arquivada — desarquive para continuar.';

export function ChatView({
  sessionId = null,
  projectId,
  state,
  visible,
  provider,
  accountDisplay,
  model,
  effort,
  mode,
  defaultModes,
  inWorktree = false,
  catalog,
  readOnly = false,
  onChangeModelConfig,
  onChangeMode,
  onSetDefaultMode,
  onRestoreCheckpoint,
  onSend,
  onCancel,
}: ChatViewProps) {
  const [draft, setDraft] = useState('');
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null);
  const [dismissedTriggerKey, setDismissedTriggerKey] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fileResults, setFileResults] = useState<{
    files: string[];
    truncated: boolean;
    loading: boolean;
  }>({ files: [], truncated: false, loading: false });
  const [commandResults, setCommandResults] = useState<{
    commands: ProjectCommandView[];
    loading: boolean;
  }>({ commands: [], loading: false });
  const searchSeqRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const { items, running } = state;
  const last = items[items.length - 1];
  const thinking = running && !(last?.type === 'assistant' && last.streaming);

  const triggerKey = trigger ? `${trigger.kind}:${trigger.start}:${trigger.query}` : null;
  const activeTrigger =
    !readOnly && visible && trigger && triggerKey !== dismissedTriggerKey ? trigger : null;

  useEffect(() => {
    if (!activeTrigger || activeTrigger.kind !== 'file' || projectId === null) return;
    const seq = ++searchSeqRef.current;
    const timer = setTimeout(() => {
      void window.inova
        .searchFiles({
          projectId,
          query: activeTrigger.query,
          limit: 40,
          ...(sessionId ? { sessionId } : {}),
        })
        .then((result) => {
          if (searchSeqRef.current !== seq) return;
          setFileResults(
            result.ok
              ? { files: result.value.files, truncated: result.value.truncated, loading: false }
              : { files: [], truncated: false, loading: false },
          );
        })
        .catch(() => {
          if (searchSeqRef.current === seq) {
            setFileResults({ files: [], truncated: false, loading: false });
          }
        });
    }, FILE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [activeTrigger, projectId, sessionId]);

  useEffect(() => {
    if (!activeTrigger || activeTrigger.kind !== 'command' || projectId === null) return;
    let alive = true;
    void window.inova
      .listCommands({ projectId })
      .then((result) => {
        if (!alive) return;
        setCommandResults({ commands: result.ok ? result.value : [], loading: false });
      })
      .catch(() => {
        if (alive) setCommandResults({ commands: [], loading: false });
      });
    return () => {
      alive = false;
    };
  }, [activeTrigger?.kind, projectId]);

  const filteredCommands = useMemo(
    () =>
      activeTrigger?.kind === 'command'
        ? filterCommands(commandResults.commands, activeTrigger.query)
        : [],
    [activeTrigger, commandResults.commands],
  );

  const syncTrigger = (text: string, cursor: number) => {
    const next = detectComposerTrigger(text, cursor);
    setTrigger(next);
    setActiveIndex(0);
    setDismissedTriggerKey(null);
    if (next?.kind === 'file') {
      setFileResults((current) => ({ ...current, loading: true }));
    } else if (next?.kind === 'command') {
      setCommandResults((current) => ({ ...current, loading: current.commands.length === 0 }));
    }
  };

  const applySelectedFile = (filePath: string) => {
    if (!activeTrigger || activeTrigger.kind !== 'file') return;
    const applied = applyFileSuggestion({ text: draft, trigger: activeTrigger, filePath });
    setDraft(applied.text);
    setTrigger(null);
    setActiveIndex(0);
    queueMicrotask(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(applied.cursor, applied.cursor);
    });
  };

  const applySelectedCommand = (command: ProjectCommandView) => {
    if (!activeTrigger || activeTrigger.kind !== 'command') return;
    const applied = applyCommandSuggestion({ text: draft, trigger: activeTrigger, command });
    setDraft(applied.text);
    setTrigger(null);
    setActiveIndex(0);
    queueMicrotask(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(applied.cursor, applied.cursor);
    });
  };

  const popupModel: ComposerPopupModel | null = useMemo(() => {
    if (!activeTrigger || projectId === null) return null;
    if (activeTrigger.kind === 'file') {
      const bounded =
        fileResults.files.length === 0 ? 0 : Math.min(activeIndex, fileResults.files.length - 1);
      return {
        kind: 'file',
        items: fileResults.files,
        truncated: fileResults.truncated,
        loading: fileResults.loading,
        activeIndex: bounded,
        onSelect: applySelectedFile,
      };
    }
    const bounded =
      filteredCommands.length === 0 ? 0 : Math.min(activeIndex, filteredCommands.length - 1);
    return {
      kind: 'command',
      items: filteredCommands,
      loading: commandResults.loading,
      activeIndex: bounded,
      onSelect: applySelectedCommand,
    };
  }, [
    activeTrigger,
    projectId,
    fileResults,
    filteredCommands,
    commandResults.loading,
    activeIndex,
  ]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list !== null && stickRef.current) list.scrollTop = list.scrollHeight;
  }, [items, thinking, visible]);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, MAX_COMPOSER_PX)}px`;
  }, [draft, visible]);

  const onScroll = () => {
    const list = listRef.current;
    if (list === null) return;
    stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
  };

  const submit = () => {
    const prompt = draft.trim();
    if (prompt === '' || running || readOnly) return;
    stickRef.current = true;
    onSend(prompt);
    setDraft('');
    setTrigger(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (popupModel) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const total = popupModel.items.length;
        if (total > 0) setActiveIndex((popupModel.activeIndex + 1) % total);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const total = popupModel.items.length;
        if (total > 0) setActiveIndex((popupModel.activeIndex - 1 + total) % total);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedTriggerKey(triggerKey);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        const count = popupModel.items.length;
        if (count > 0) {
          event.preventDefault();
          if (popupModel.kind === 'file') {
            const chosen = popupModel.items[popupModel.activeIndex];
            if (chosen !== undefined) popupModel.onSelect(chosen);
          } else {
            const chosen = popupModel.items[popupModel.activeIndex];
            if (chosen !== undefined) popupModel.onSelect(chosen);
          }
          return;
        }
      }
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  };

  return (
    <section className="chat-view" style={visible ? undefined : { display: 'none' }}>
      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        <div className="chat-list-inner">
          {items.length === 0 && !running ? (
            <div className="chat-empty">Envie uma mensagem para começar</div>
          ) : null}
          {items.map((item, index) => (
            <Message
              key={item.id}
              item={item}
              provider={provider}
              busy={running || readOnly}
              onRestoreCheckpoint={onRestoreCheckpoint}
              onFixVerification={(fixPrompt) => {
                if (!running && !readOnly) onSend(fixPrompt);
              }}
              showAgentLabel={
                (item.type === 'assistant' || item.type === 'tool') &&
                (index === 0 || items[index - 1]?.type === 'user')
              }
            />
          ))}
          {thinking ? (
            <div className="chat-row chat-thinking" aria-live="polite">
              pensando
              <span className="chat-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="chat-composer-wrap">
        {popupModel ? <ComposerPopup model={popupModel} /> : null}
        <div className="chat-composer">
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={1}
            value={draft}
            placeholder={readOnly ? ARCHIVED_HINT : 'Responda ao agente… (@arquivo, /comando)'}
            disabled={readOnly}
            onChange={(event) => {
              const nextValue = event.target.value;
              setDraft(nextValue);
              syncTrigger(nextValue, event.target.selectionStart ?? nextValue.length);
            }}
            onClick={(event) => {
              const target = event.currentTarget;
              syncTrigger(target.value, target.selectionStart ?? target.value.length);
            }}
            onKeyDown={onKeyDown}
          />
          <div className="chat-composer-bar">
            {provider ? (
              <>
                <span
                  className="chat-chip"
                  title={
                    accountDisplay !== null
                      ? `${PROVIDER_NAME[provider]} · ${accountDisplay}`
                      : PROVIDER_NAME[provider]
                  }
                >
                  <ProviderBadge provider={provider} size={16} />
                  <span className="chat-chip-text">
                    {PROVIDER_NAME[provider]}
                    {accountDisplay !== null ? ` · ${accountDisplay}` : ''}
                  </span>
                </span>
                <ModelEffortPicker
                  model={model}
                  effort={effort}
                  catalog={catalog}
                  disabled={readOnly || running}
                  onChange={onChangeModelConfig}
                />
                <ModePicker
                  provider={provider}
                  sessionMode={mode}
                  defaultModes={defaultModes}
                  inWorktree={inWorktree}
                  disabled={readOnly || running}
                  onChangeMode={onChangeMode}
                  onSetDefault={onSetDefaultMode}
                />
              </>
            ) : null}
            {running ? (
              <button
                type="button"
                className="chat-send chat-send-stop"
                aria-label="Parar"
                onClick={onCancel}
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                className="chat-send"
                aria-label="Enviar mensagem"
                disabled={readOnly || draft.trim() === ''}
                onClick={submit}
              >
                <SendIcon size={16} />
              </button>
            )}
          </div>
        </div>
        {readOnly ? <p className="chat-readonly-hint">{ARCHIVED_HINT}</p> : null}
      </div>
    </section>
  );
}
