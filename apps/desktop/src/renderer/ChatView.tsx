import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { isCircuitBreakerMessage } from '@inova/core/circuit-breaker';
import { isRateLimitMessage } from '@inova/core/handoff';
import type { ProviderModels } from '@inova/core/models';
import { nativeSlashCommands, type SlashCommandAction } from '@inova/core/slash-commands';
import type {
  EffortLevel,
  ExecutionMode,
  ProviderId,
  QueuedTurn,
  Settings,
} from '@inova/core/types';
import type { AccountView, AttachmentKind, ProjectCommandView } from '../shared/api';
import { AttachMenu } from './AttachMenu';
import type { ChatItem, ChatState } from './chat-reducer';
import { composerPrimaryAction } from './composer-action';
import type { ComposerFormat } from './composer-format';
import { RichComposer, type RichComposerHandle } from './RichComposer';
import { ComposerPopup, type ComposerPopupModel } from './ComposerPopup';
import { ComposerToolbar } from './ComposerToolbar';
import { isMacPlatform } from './shortcuts';
import {
  applyCommandSuggestion,
  buildPromptWithAttachedFiles,
  detachFileTrigger,
  detectComposerTrigger,
  filterSlashSuggestions,
  isSameComposerTrigger,
  nativeActionForSubmit,
  parseLeadingSlashTag,
  parseMessageFileSegments,
  parsePinCommand,
  resolveDroppedPath,
  type ComposerTrigger,
  type DroppedPath,
  type SlashSuggestion,
} from './composer-trigger';
import { ConfirmModal } from './ConfirmModal';
import { DictationControl } from './DictationControl';
import { appendDictation, formatMegabytes } from './dictation';
import { describeFailoverBanner, type FailoverNotice } from './failover-notice';
import { useI18n } from './I18nContext';
import {
  AlertIcon,
  ClockIcon,
  CloseIcon,
  CopyIcon,
  FileIcon,
  FolderIcon,
  GitBranchIcon,
  GitForkIcon,
  ListTodoIcon,
  PlayIcon,
  RefreshIcon,
  RotateCcwIcon,
  SendIcon,
  StopFilledIcon,
  TerminalIcon,
  ThumbDownIcon,
  ThumbUpIcon,
  ZapIcon,
} from './icons';
import { copyToClipboard } from './clipboard';
import { Markdown } from './Markdown';
import { ModelEffortPicker } from './ModelEffortPicker';
import { ModePicker } from './ModePicker';
import { ProviderBadge } from './ProviderBadge';
import { formatMessageTime } from './relative-time';
import { PROVIDER_NAME } from './provider-meta';
import { queueCountLabel, queuedCardLabel } from './queue-state';
import { ToolCard } from './ToolCard';
import {
  activeTurnActivity,
  agentTurnFooters,
  groupChatItems,
  summarizeWork,
  type AgentTurnFooter,
  type ChatEntry,
} from './turn-groups';
import { useDictation, type Dictation } from './useDictation';
import './chat.css';

export interface ChatViewHandle {
  focusComposer: () => boolean;
  toggleDictation: () => boolean;
}

export interface ChatViewProps {
  ref?: Ref<ChatViewHandle>;
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
  workingDir?: string | null;
  voiceHints?: readonly string[];
  dictationLanguage?: Settings['voice']['language'];
  collapseFinishedTurns?: boolean;
  catalog: ProviderModels;
  readOnly?: boolean;
  queuedTurns?: readonly QueuedTurn[];
  queuePaused?: boolean;
  queueWaitingForAccount?: boolean;
  busyConflict?: { prompt: string; exhausted: boolean; message?: string } | null;
  failoverNotice?: FailoverNotice | null;
  alternativeAccounts?: readonly AccountView[];
  onChangeModelConfig: (patch: { model?: string | null; effort?: EffortLevel | null }) => void;
  onChangeMode: (mode: ExecutionMode) => void;
  onSetDefaultMode: (mode: ExecutionMode) => void;
  onRestoreCheckpoint?: (input: { ref: string; skippedLargeFiles: string[] }) => void;
  onForkTurn?: (turnIndex: number) => void;
  onRewindTurn?: (turnIndex: number) => void;
  onRegenerate?: (extraDirs: string[]) => void;
  onClearSession?: () => void;
  onFeedback?: (input: { turnIndex: number; value: 'up' | 'down' | null }) => void;
  onWarn?: (message: string) => void;
  onOpenHandoff?: () => void;
  onSendToParent?: (text: string) => void;
  onEnqueuePrompt?: (input: { prompt: string; extraDirs?: string[] }) => void;
  onResumeQueue?: () => void;
  onCancelQueuedTurn?: (turnId: string) => void;
  onSwitchAccountAndRetry?: (input: { accountId: string; prompt: string }) => void;
  onDismissBusyConflict?: () => void;
  onAcceptFailover?: () => void;
  onRevertFailover?: () => void;
  composerSeed?: string | null;
  onComposerSeedApplied?: () => void;
  onPinNote?: (note: string) => void;
  onSend: (prompt: string, extraDirs: string[]) => void;
  onCancel: () => void;
}

const IS_MAC = isMacPlatform(navigator.platform);
const NEAR_BOTTOM_PX = 80;
const NO_ACTIVE_FORMATS: ReadonlySet<ComposerFormat> = new Set();
const FILE_SEARCH_DEBOUNCE_MS = 80;

function ThinkingCard({ item }: { item: Extract<ChatItem, { type: 'thinking' }> }) {
  const first =
    item.text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? '';
  return (
    <details
      className={
        item.streaming
          ? 'chat-tool chat-thinking-card chat-thinking-streaming'
          : 'chat-tool chat-thinking-card'
      }
      open={item.streaming}
    >
      <summary className="chat-tool-summary">
        <span className="chat-tool-icon">
          <ZapIcon size={15} />
        </span>
        <span className="chat-tool-name">Raciocínio</span>
        {first ? <span className="chat-tool-preview chat-thinking-preview">{first}</span> : null}
        {item.streaming ? (
          <span className="chat-tool-status chat-tool-pending">
            <span className="dot pulse" aria-hidden="true" />
            ativo
          </span>
        ) : null}
      </summary>
      <div className="chat-tool-body chat-thinking-body">
        <Markdown text={item.text} streaming={item.streaming} />
      </div>
    </details>
  );
}

function formatElapsedSeconds(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function LiveTurnStatus({ activity, elapsedSec }: { activity: string; elapsedSec: number }) {
  return (
    <div className="chat-row chat-thinking" aria-live="polite">
      <span className="dot pulse" aria-hidden="true" />
      <span className="chat-thinking-label">{activity}</span>
      <span className="chat-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="chat-thinking-timer">{formatElapsedSeconds(elapsedSec)}</span>
    </div>
  );
}

function directoryName(workingDir: string | null): string | null {
  if (!workingDir) return null;
  const parts = workingDir.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? workingDir;
}

function ChatEmptyState({
  provider,
  modelLabel,
  workingDir,
  inWorktree,
  readOnly,
  hasReviewCommand,
  onPickSuggestion,
}: {
  provider: ProviderId | null;
  modelLabel: string;
  workingDir: string | null;
  inWorktree: boolean;
  readOnly: boolean;
  hasReviewCommand: boolean;
  onPickSuggestion: (prompt: string) => void;
}) {
  const folder = directoryName(workingDir);
  const providerLabel = provider ? PROVIDER_NAME[provider] : 'Agente';
  const suggestions = [
    {
      label: 'Explorar arquitetura',
      prompt:
        'Explique a arquitetura principal deste projeto e os pontos de entrada mais importantes.',
    },
    {
      label: 'Revisar alterações',
      prompt: hasReviewCommand
        ? '/review'
        : 'Revise as alterações atuais no Git procurando bugs, riscos e pontos de melhoria.',
    },
    {
      label: 'Executar testes',
      prompt: 'Execute a suíte de testes relevante e resuma o que está passando ou falhando.',
    },
    {
      label: 'Planejar tarefa',
      prompt: 'Ajude a planejar passo a passo a próxima alteração antes de editar arquivos.',
    },
  ];

  return (
    <div className="chat-empty-card">
      <div className="chat-empty-head">
        {provider ? <ProviderBadge provider={provider} size={28} /> : null}
        <div>
          <div className="chat-empty-title">
            {readOnly
              ? 'Sessão arquivada sem mensagens'
              : `Pronto para trabalhar com ${providerLabel}`}
          </div>
          <div className="chat-empty-sub">
            {readOnly
              ? 'Esta conversa não recebeu mensagens antes de ser encerrada.'
              : 'Envie uma instrução, arraste arquivos ou escolha um atalho abaixo.'}
          </div>
        </div>
      </div>
      <div className="chat-empty-meta">
        <span className="chat-empty-pill">{modelLabel}</span>
        {folder ? (
          <span className="chat-empty-pill" title={workingDir ?? undefined}>
            <FolderIcon size={12} />
            {folder}
          </span>
        ) : null}
        {inWorktree ? (
          <span className="chat-empty-pill">
            <GitBranchIcon size={12} />
            Worktree isolada
          </span>
        ) : null}
      </div>
      {readOnly ? null : (
        <div className="chat-empty-chips">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              className="chat-empty-chip"
              onClick={() => onPickSuggestion(suggestion.prompt)}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
        : item.status === 'skipped'
          ? 'Verificação cancelada'
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
              (c) =>
                `${c.passed ? 'OK' : item.status === 'running' ? '...' : item.status === 'skipped' ? '-' : 'ERRO'} ${c.label}`,
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
                    : item.status === 'running' || item.status === 'skipped'
                      ? 'chat-verification-badge'
                      : 'chat-verification-badge chat-verification-fail'
                }
              >
                {item.status === 'running'
                  ? 'executando'
                  : item.status === 'skipped'
                    ? 'cancelada'
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
  turnIndex: number;
  isLatestTurn?: boolean;
  showAgentLabel: boolean;
  provider: ProviderId | null;
  busy: boolean;
  knownCommands: ReadonlySet<string>;
  onRestoreCheckpoint?: (input: { ref: string; skippedLargeFiles: string[] }) => void;
  onFixVerification?: (prompt: string) => void;
  onForkTurn?: (turnIndex: number) => void;
  onRewindTurn?: (turnIndex: number) => void;
  onCopyText: (text: string) => void;
  agentMeta?: ReactNode;
  onOpenHandoff?: () => void;
  latestCheckpoint?: { ref: string; skippedLargeFiles: string[] } | null;
  queuePaused?: boolean;
  onResumeQueue?: () => void;
}

interface AgentMetaProps {
  footer: AgentTurnFooter;
  model: string | null;
  feedback: 'up' | 'down' | null;
  busy: boolean;
  onCopyText: (text: string) => void;
  onFeedback?: (input: { turnIndex: number; value: 'up' | 'down' | null }) => void;
  onRegenerate?: () => void;
  onSendToParent?: (text: string) => void;
}

function AgentMeta({
  footer,
  model,
  feedback,
  busy,
  onCopyText,
  onFeedback,
  onRegenerate,
  onSendToParent,
}: AgentMetaProps) {
  const time = footer.at ? formatMessageTime(footer.at) : '';
  const vote = (value: 'up' | 'down') =>
    onFeedback?.({ turnIndex: footer.turnIndex, value: feedback === value ? null : value });
  return (
    <div className="chat-meta chat-meta-agent">
      {time ? <span className="chat-meta-time">{time}</span> : null}
      {time ? <span className="chat-meta-sep">·</span> : null}
      <button
        type="button"
        className="chat-meta-btn"
        aria-label="Copiar resposta"
        data-tooltip="Copiar resposta"
        onClick={() => onCopyText(footer.text)}
      >
        <CopyIcon size={12} />
      </button>
      {onFeedback ? (
        <>
          <button
            type="button"
            className={`chat-meta-btn${feedback === 'up' ? ' chat-meta-btn-active' : ''}`}
            aria-label="Gostei"
            aria-pressed={feedback === 'up'}
            data-tooltip="Gostei"
            onClick={() => vote('up')}
          >
            <ThumbUpIcon size={12} />
          </button>
          <button
            type="button"
            className={`chat-meta-btn${feedback === 'down' ? ' chat-meta-btn-active' : ''}`}
            aria-label="Não gostei"
            aria-pressed={feedback === 'down'}
            data-tooltip="Não gostei"
            onClick={() => vote('down')}
          >
            <ThumbDownIcon size={12} />
          </button>
        </>
      ) : null}
      {onRegenerate && footer.isLastTurn ? (
        <button
          type="button"
          className="chat-meta-btn"
          aria-label="Regenerar"
          disabled={busy}
          data-tooltip="Regenerar: refaz este turno com a mesma mensagem"
          onClick={onRegenerate}
        >
          <RefreshIcon size={12} />
        </button>
      ) : null}
      {onSendToParent && footer.text.trim() !== '' ? (
        <button
          type="button"
          className="chat-meta-btn chat-meta-btn-action"
          data-tooltip="Enviar achados desta revisão para o rascunho da sessão pai"
          onClick={() => onSendToParent(footer.text)}
        >
          <SendIcon size={12} />
          <span>Enviar para sessão pai</span>
        </button>
      ) : null}
      {model ? <span className="chat-meta-model">{model}</span> : null}
    </div>
  );
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
  turnIndex,
  isLatestTurn = false,
  showAgentLabel,
  provider,
  busy,
  knownCommands,
  onRestoreCheckpoint,
  onFixVerification,
  onForkTurn,
  onRewindTurn,
  onCopyText,
  agentMeta,
  onOpenHandoff,
  latestCheckpoint,
  queuePaused = false,
  onResumeQueue,
}: MessageProps) {
  const label = showAgentLabel ? <AgentLabel provider={provider} /> : null;
  const time = item.type === 'user' && item.at ? formatMessageTime(item.at) : '';
  switch (item.type) {
    case 'user': {
      const slash = parseLeadingSlashTag({ text: item.text, known: knownCommands });
      const bodyText = slash === null ? item.text : slash.rest;
      return (
        <div className="chat-row chat-row-user">
          <div className="chat-user-bubble">
            {slash === null ? null : (
              <>
                <span className="chat-file-tag" title={`/${slash.name}`}>
                  <TerminalIcon size={12} />
                  <span className="chat-file-tag-path mono">/{slash.name}</span>
                </span>
                {bodyText === '' ? null : ' '}
              </>
            )}
            {parseMessageFileSegments(bodyText).map((segment, segmentIndex) =>
              segment.kind === 'file' ? (
                <span
                  key={`${segment.path}-${segmentIndex}`}
                  className="chat-file-tag"
                  title={segment.path}
                >
                  <FileIcon size={12} />
                  <span className="chat-file-tag-path mono">{segment.path}</span>
                </span>
              ) : (
                <span key={`text-${segmentIndex}`}>{segment.value}</span>
              ),
            )}
          </div>
          <div className="chat-meta">
            {time ? <span className="chat-meta-time">{time}</span> : null}
            {time ? <span className="chat-meta-sep">·</span> : null}
            <button
              type="button"
              className="chat-meta-btn"
              aria-label="Copiar mensagem"
              data-tooltip="Copiar mensagem"
              onClick={() => onCopyText(item.text)}
            >
              <CopyIcon size={12} />
            </button>
            {onRewindTurn ? (
              <button
                type="button"
                className="chat-meta-btn"
                aria-label="Retroceder"
                disabled={busy}
                data-tooltip="Retroceder: desfaz este turno e os arquivos editados"
                onClick={() => onRewindTurn(turnIndex)}
              >
                <RotateCcwIcon size={12} />
              </button>
            ) : null}
            {onForkTurn ? (
              <button
                type="button"
                className="chat-meta-btn"
                aria-label="Bifurcar"
                disabled={busy}
                data-tooltip="Bifurcar sessão a partir deste turno"
                onClick={() => onForkTurn(turnIndex)}
              >
                <GitForkIcon size={12} />
              </button>
            ) : null}
          </div>
        </div>
      );
    }
    case 'assistant':
      return (
        <div className="chat-row chat-row-assistant">
          {label}
          <div>
            <Markdown text={item.text} streaming={item.streaming} />
            {item.streaming ? <span className="chat-caret" aria-hidden="true" /> : null}
          </div>
          {agentMeta}
        </div>
      );
    case 'tool':
      return (
        <div className="chat-row">
          {label}
          <ToolCard item={item} defaultOpen={isLatestTurn} onCopyText={onCopyText} />
        </div>
      );
    case 'thinking':
      return (
        <div className="chat-row">
          {label}
          <ThinkingCard item={item} />
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
                data-tooltip="Restaurar os arquivos para este checkpoint"
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
    case 'error': {
      const showCircuitActions =
        isCircuitBreakerMessage(item.message) &&
        ((queuePaused && Boolean(onResumeQueue)) ||
          (Boolean(latestCheckpoint) && Boolean(onRestoreCheckpoint)));
      return (
        <div className="chat-row">
          <div className="chat-error" role="alert">
            <div>{item.message}</div>
            {onOpenHandoff && isRateLimitMessage(item.message) ? (
              <div className="chat-error-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  data-tooltip="Abrir um resumo desta sessão em outra conta"
                  onClick={onOpenHandoff}
                >
                  Continuar com resumo em outra conta
                </button>
              </div>
            ) : null}
            {showCircuitActions ? (
              <div className="chat-error-actions">
                {queuePaused && onResumeQueue ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busy}
                    onClick={onResumeQueue}
                  >
                    Retomar fila
                  </button>
                ) : null}
                {latestCheckpoint && onRestoreCheckpoint ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => onRestoreCheckpoint(latestCheckpoint)}
                  >
                    Restaurar último checkpoint
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      );
    }
  }
}

function WorkGroup({
  entries,
  label,
  renderEntry,
}: {
  entries: readonly ChatEntry[];
  label: ReactNode;
  renderEntry: (entry: ChatEntry) => ReactNode;
}) {
  return (
    <div className="chat-row">
      {label}
      <details className="chat-tool chat-work">
        <summary className="chat-tool-summary">
          <span className="chat-tool-icon">
            <ListTodoIcon size={16} />
          </span>
          <span className="chat-tool-name">Trabalho do turno</span>
          <span className="chat-tool-preview chat-work-preview">{summarizeWork(entries)}</span>
        </summary>
        <div className="chat-work-body">{entries.map((entry) => renderEntry(entry))}</div>
      </details>
    </div>
  );
}

function dropAccessDescription(input: {
  dropped: readonly DroppedPath[];
  provider: ProviderId | null;
}): string {
  const { dropped, provider } = input;
  const paths = dropped.map((item) => item.mention).join(', ');
  const dirs = [...new Set(dropped.flatMap((item) => item.grantDir ?? []))].join(', ');
  const agent = provider ? PROVIDER_NAME[provider] : 'O agente';
  const scope =
    provider === 'claude'
      ? `${agent} recebe acesso à pasta ${dirs} enquanto esta sessão estiver aberta.`
      : `${agent} recebe o caminho no prompt. O acesso depende do modo de execução da sessão.`;
  return `${paths} está fora da pasta do projeto. ${scope}`;
}

function DictationStatus({ dictation }: { dictation: Dictation }) {
  if (dictation.error !== null) {
    return (
      <div className="chat-dictation chat-dictation-error" role="alert">
        <span className="chat-dictation-text">{dictation.error}</span>
        <button
          type="button"
          className="chat-file-tag-remove"
          aria-label="Fechar aviso do ditado"
          data-tooltip="Fechar aviso do ditado"
          onClick={dictation.dismissError}
        >
          <CloseIcon size={12} />
        </button>
      </div>
    );
  }
  const text =
    dictation.phase === 'recording'
      ? dictation.interim === ''
        ? 'Ouvindo…'
        : dictation.interim
      : dictation.phase === 'transcribing'
        ? 'Transcrevendo…'
        : dictation.phase === 'downloading'
          ? `Baixando o modelo de voz… ${dictation.downloadPercent}%`
          : null;
  if (text === null) return null;
  return (
    <div className="chat-dictation" role="status">
      {dictation.phase === 'recording' ? <span className="dot pulse" aria-hidden="true" /> : null}
      <span className="chat-dictation-text">{text}</span>
      <button
        type="button"
        className="chat-file-tag-remove"
        aria-label="Cancelar ditado"
        data-tooltip="Cancelar ditado e descartar o áudio"
        onClick={dictation.cancel}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}

const NO_VOICE_HINTS: readonly string[] = [];
const ARCHIVED_HINT = 'Sessão arquivada — desarquive para continuar.';

export function ChatView({
  ref,
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
  workingDir = null,
  voiceHints = NO_VOICE_HINTS,
  dictationLanguage,
  collapseFinishedTurns = true,
  catalog,
  readOnly = false,
  queuedTurns = [],
  queuePaused = false,
  queueWaitingForAccount = false,
  busyConflict = null,
  failoverNotice = null,
  alternativeAccounts = [],
  onChangeModelConfig,
  onChangeMode,
  onSetDefaultMode,
  onRestoreCheckpoint,
  onForkTurn,
  onRewindTurn,
  onRegenerate,
  onClearSession,
  onFeedback,
  onWarn,
  onOpenHandoff,
  onSendToParent,
  onEnqueuePrompt,
  onResumeQueue,
  onCancelQueuedTurn,
  onSwitchAccountAndRetry,
  onDismissBusyConflict,
  onAcceptFailover,
  onRevertFailover,
  composerSeed = null,
  onComposerSeedApplied,
  onPinNote,
  onSend,
  onCancel,
}: ChatViewProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [activeFormats, setActiveFormats] = useState(NO_ACTIVE_FORMATS);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<DroppedPath[] | null>(null);
  const [grantedDirs, setGrantedDirs] = useState<string[]>([]);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [showFormatToolbar, setShowFormatToolbar] = useState(false);
  const [pickerOpenRequest, setPickerOpenRequest] = useState(0);
  const dictation = useDictation({
    hints: voiceHints,
    language: dictationLanguage,
    onText: (text) => {
      const editor = editorRef.current;
      if (editor === null) return;
      const current = editor.getText();
      editor.insertText(appendDictation(current, text).slice(current.length));
    },
  });
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
  const triggerRef = useRef<ComposerTrigger | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RichComposerHandle>(null);
  const stickRef = useRef(true);
  const { items, running } = state;
  const hasContent = draft.trim() !== '' || attachedFiles.length > 0;
  const primaryAction = composerPrimaryAction({
    running,
    hasContent,
    canEnqueue: onEnqueuePrompt !== undefined,
  });
  const userTurnIndices = useMemo(() => {
    let counter = -1;
    return items.map((item) => {
      if (item.type === 'user') counter += 1;
      return counter;
    });
  }, [items]);
  const lastUserTurnIndex = useMemo(
    () => userTurnIndices.reduce((max, current) => (current > max ? current : max), -1),
    [userTurnIndices],
  );
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setElapsedSec(0);
    });
    if (!running) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(() => {
      setElapsedSec((current) => current + 1);
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [running, sessionId]);
  const matchedModel = model ? catalog.models.find((entry) => entry.id === model) : undefined;
  const resolvedModelLabel =
    model === null ? catalog.defaultModelLabel : (matchedModel?.label ?? model);
  const pickSuggestion = (prompt: string) => {
    editorRef.current?.setMarkdown(prompt);
    setDraft(prompt);
    editorRef.current?.focus();
  };
  const blocks = useMemo(
    () => groupChatItems(items, running, collapseFinishedTurns),
    [items, running, collapseFinishedTurns],
  );
  const footers = useMemo(() => agentTurnFooters({ items, running }), [items, running]);
  const latestCheckpoint = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const candidate = items[i];
      if (candidate?.type === 'checkpoint') {
        return { ref: candidate.ref, skippedLargeFiles: candidate.skippedLargeFiles };
      }
    }
    return null;
  }, [items]);
  const copyText = (text: string) => {
    void copyToClipboard({ text, onError: (message) => onWarn?.(message) });
  };

  const toggleDictation = dictation.toggle;
  useImperativeHandle(
    ref,
    () => ({
      focusComposer: () => {
        const editor = editorRef.current;
        if (readOnly || editor === null) return false;
        editor.focus();
        return true;
      },
      toggleDictation: () => {
        if (readOnly) return false;
        toggleDictation();
        return true;
      },
    }),
    [readOnly, toggleDictation],
  );
  useEffect(() => {
    const editor = editorRef.current;
    if (composerSeed === null || !visible || editor === null) return;
    editor.setMarkdown(composerSeed);
    onComposerSeedApplied?.();
  }, [composerSeed, visible, onComposerSeedApplied]);
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

  const commandTriggerActive = activeTrigger?.kind === 'command';
  useEffect(() => {
    if (projectId === null) return;
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
  }, [commandTriggerActive, projectId]);

  const nativeCommands = useMemo(() => (provider ? nativeSlashCommands(provider) : []), [provider]);
  const knownCommands = useMemo(
    () =>
      new Set([
        ...nativeCommands.map((command) => command.name),
        ...commandResults.commands.map((command) => command.name),
      ]),
    [nativeCommands, commandResults.commands],
  );

  const filteredCommands = useMemo(
    () =>
      activeTrigger?.kind === 'command'
        ? filterSlashSuggestions({
            native: nativeCommands,
            project: commandResults.commands,
            query: activeTrigger.query,
          })
        : [],
    [activeTrigger, nativeCommands, commandResults.commands],
  );

  const commitTrigger = (next: ComposerTrigger | null) => {
    triggerRef.current = next;
    setTrigger(next);
  };

  const syncTrigger = (text: string, cursor: number) => {
    const next = detectComposerTrigger(text, cursor);
    if (isSameComposerTrigger(triggerRef.current, next)) return;
    commitTrigger(next);
    setActiveIndex(0);
    setDismissedTriggerKey(null);
    if (next?.kind === 'file') {
      setFileResults((current) => ({ ...current, loading: true }));
    } else if (next?.kind === 'command') {
      setCommandResults((current) => ({ ...current, loading: current.commands.length === 0 }));
    }
  };

  const syncFromEditor = () => {
    const editor = editorRef.current;
    if (editor !== null) syncTrigger(editor.getText(), editor.getCaretOffset());
  };

  const applySelectedFile = (filePath: string) => {
    const editor = editorRef.current;
    if (!activeTrigger || activeTrigger.kind !== 'file' || editor === null) return;
    const text = editor.getText();
    const applied = detachFileTrigger({ text, trigger: activeTrigger });
    editor.replaceRange({
      start: applied.cursor,
      end: applied.cursor + text.length - applied.text.length,
      text: '',
    });
    setAttachedFiles((current) => (current.includes(filePath) ? current : [...current, filePath]));
    commitTrigger(null);
    setActiveIndex(0);
  };

  const insertCommandTag = (command: Pick<ProjectCommandView, 'name'>) => {
    const editor = editorRef.current;
    if (!activeTrigger || activeTrigger.kind !== 'command' || editor === null) return;
    const applied = applyCommandSuggestion({
      text: editor.getText(),
      trigger: activeTrigger,
      command,
    });
    const tag = applied.text.slice(activeTrigger.start, applied.cursor);
    editor.replaceRange({ start: activeTrigger.start, end: activeTrigger.end, text: tag });
  };

  const runNativeAction = (action: SlashCommandAction) => {
    if (running) return;
    if (action === 'clear') setConfirmingClear(true);
    else if (action === 'model-picker') setPickerOpenRequest((current) => current + 1);
  };

  const applySelectedCommand = (suggestion: SlashSuggestion) => {
    const editor = editorRef.current;
    if (!activeTrigger || activeTrigger.kind !== 'command' || editor === null) return;
    const action = suggestion.kind === 'native' ? suggestion.command.action : 'passthrough';
    if (action === 'passthrough' || action === 'pin') {
      insertCommandTag(suggestion.command);
    } else {
      if (running) return;
      editor.clear();
      setDraft('');
      setAttachedFiles([]);
      runNativeAction(action);
    }
    commitTrigger(null);
    setActiveIndex(0);
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
      nativeGroupLabel: provider ? `Comandos do ${PROVIDER_NAME[provider]}` : 'Comandos',
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
    provider,
  ]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list !== null && stickRef.current) list.scrollTop = list.scrollHeight;
  }, [items, thinking, visible]);

  useEffect(() => {
    if (visible) editorRef.current?.focus();
  }, [visible]);

  const onScroll = () => {
    const list = listRef.current;
    if (list === null) return;
    stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
  };

  const attachMentions = (dropped: readonly DroppedPath[]) => {
    setAttachedFiles((current) => [...new Set([...current, ...dropped.map((d) => d.mention)])]);
    editorRef.current?.focus();
  };

  const hasFiles = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes('Files');

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (readOnly || !hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'link';
    setDragging(true);
  };

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    setDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (readOnly || !hasFiles(event)) return;
    event.preventDefault();
    setDragging(false);
    const dropped = Array.from(event.dataTransfer.items).flatMap((item) => {
      const file = item.kind === 'file' ? item.getAsFile() : null;
      const path = file ? window.inova.getPathForFile(file) : '';
      if (path === '') return [];
      const isDirectory = item.webkitGetAsEntry()?.isDirectory ?? false;
      return [resolveDroppedPath({ path, cwd: workingDir, isDirectory })];
    });
    routeDropped(dropped);
  };

  const routeDropped = (dropped: readonly DroppedPath[]) => {
    const outside = dropped.filter((item) => item.grantDir !== null);
    attachMentions(dropped.filter((item) => item.grantDir === null));
    if (outside.length > 0) setPendingDrop(outside);
  };

  const pickAttachments = async (kind: AttachmentKind) => {
    const result = await window.inova.pickAttachments({ kind });
    if (!result.ok || result.value.length === 0) return;
    routeDropped(
      result.value.map(({ path, isDirectory }) =>
        resolveDroppedPath({ path, cwd: workingDir, isDirectory }),
      ),
    );
  };

  const formatDraft = (format: ComposerFormat) => {
    if (!readOnly) editorRef.current?.format(format);
  };

  const confirmPendingDrop = () => {
    if (pendingDrop === null) return;
    const dirs = pendingDrop.flatMap((item) => item.grantDir ?? []);
    setGrantedDirs((current) => [...new Set([...current, ...dirs])]);
    attachMentions(pendingDrop);
    setPendingDrop(null);
  };

  const renderEntry = ({ item, index }: ChatEntry, showAgentLabel = false) => {
    const footer = footers.get(index);
    const isLatestTurn = (userTurnIndices[index] ?? -1) === lastUserTurnIndex;
    return (
      <Message
        key={item.id}
        item={item}
        isLatestTurn={isLatestTurn}
        onCopyText={copyText}
        agentMeta={
          footer ? (
            <AgentMeta
              footer={footer}
              model={state.context?.model ?? null}
              feedback={state.feedback?.[footer.turnIndex] ?? null}
              busy={running || readOnly}
              onCopyText={copyText}
              onFeedback={readOnly ? undefined : onFeedback}
              onRegenerate={readOnly || !onRegenerate ? undefined : () => onRegenerate(grantedDirs)}
              onSendToParent={onSendToParent}
            />
          ) : undefined
        }
        turnIndex={userTurnIndices[index] ?? 0}
        provider={provider}
        busy={running || readOnly}
        knownCommands={knownCommands}
        onRestoreCheckpoint={onRestoreCheckpoint}
        onForkTurn={onForkTurn}
        onRewindTurn={onRewindTurn}
        onOpenHandoff={onOpenHandoff}
        latestCheckpoint={latestCheckpoint}
        queuePaused={queuePaused}
        onResumeQueue={onResumeQueue}
        onFixVerification={(fixPrompt) => {
          if (!running && !readOnly) onSend(fixPrompt, grantedDirs);
        }}
        showAgentLabel={showAgentLabel}
      />
    );
  };

  const submit = () => {
    const editor = editorRef.current;
    const markdown = editor === null ? draft : editor.getMarkdown();
    const nativeAction = nativeActionForSubmit({ text: markdown, provider });
    if (nativeAction !== null && attachedFiles.length === 0 && !running && !readOnly) {
      editor?.clear();
      setDraft('');
      commitTrigger(null);
      runNativeAction(nativeAction.action);
      return;
    }
    const pinCommand = parsePinCommand(markdown);
    if (pinCommand !== null && attachedFiles.length === 0 && !readOnly) {
      if (pinCommand.note === '') {
        onWarn?.('Digite o texto após /pin para fixar na memória da sessão.');
        return;
      }
      if (!onPinNote) return;
      editor?.clear();
      setDraft('');
      commitTrigger(null);
      onPinNote(pinCommand.note);
      return;
    }
    const prompt = buildPromptWithAttachedFiles({ text: markdown, files: attachedFiles });
    if (prompt === '' || readOnly) return;
    if (running) {
      if (nativeAction !== null || !onEnqueuePrompt) return;
      onEnqueuePrompt({ prompt, extraDirs: grantedDirs });
    } else {
      stickRef.current = true;
      onSend(prompt, grantedDirs);
    }
    editor?.clear();
    setDraft('');
    setAttachedFiles([]);
    commitTrigger(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (popupModel) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const total = popupModel.items.length;
        if (total > 0) setActiveIndex((current) => (Math.min(current, total - 1) + 1) % total);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const total = popupModel.items.length;
        if (total > 0) {
          setActiveIndex((current) => (Math.min(current, total - 1) - 1 + total) % total);
        }
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
    <section
      className={dragging ? 'chat-view chat-view-dragging' : 'chat-view'}
      style={visible ? undefined : { display: 'none' }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {confirmingClear ? (
        <ConfirmModal
          title="Limpar a conversa?"
          description="O histórico e a memória do agente nesta sessão serão apagados. Os arquivos não mudam."
          confirmLabel="Limpar"
          danger
          onConfirm={() => {
            setConfirmingClear(false);
            onClearSession?.();
          }}
          onCancel={() => setConfirmingClear(false)}
        />
      ) : null}
      {pendingDrop ? (
        <ConfirmModal
          title="Permitir acesso ao arquivo?"
          description={dropAccessDescription({ dropped: pendingDrop, provider })}
          confirmLabel="Permitir acesso"
          onConfirm={confirmPendingDrop}
          onCancel={() => setPendingDrop(null)}
        />
      ) : null}
      {dictation.phase === 'needs-model' ? (
        <ConfirmModal
          title="Baixar o modelo de voz?"
          description={`A transcrição roda neste computador e o áudio não sai dele. O download tem ${formatMegabytes(dictation.modelBytes)} e acontece uma vez.`}
          confirmLabel="Baixar modelo"
          onConfirm={dictation.confirmDownload}
          onCancel={dictation.cancel}
        />
      ) : null}
      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        <div className="chat-list-inner">
          {items.length === 0 && !running ? (
            <ChatEmptyState
              provider={provider}
              modelLabel={resolvedModelLabel}
              workingDir={workingDir}
              inWorktree={inWorktree}
              readOnly={readOnly}
              hasReviewCommand={knownCommands.has('review')}
              onPickSuggestion={pickSuggestion}
            />
          ) : null}
          {blocks.map((block) => {
            const opensTurn = block.index === 0 || items[block.index - 1]?.type === 'user';
            if (block.kind === 'work') {
              return (
                <WorkGroup
                  key={block.id}
                  entries={block.entries}
                  label={opensTurn ? <AgentLabel provider={provider} /> : null}
                  renderEntry={renderEntry}
                />
              );
            }
            const isAgent =
              block.item.type === 'assistant' ||
              block.item.type === 'tool' ||
              block.item.type === 'thinking';
            return renderEntry(block, isAgent && opensTurn);
          })}
          {queuedTurns.map((queued) => (
            <div key={queued.turnId} className="chat-row">
              <div className="chat-queued">
                <div className="chat-queued-head">
                  <span className="chat-queued-label">
                    <ClockIcon size={13} />
                    {queuedCardLabel(queueWaitingForAccount)}
                  </span>
                  {onCancelQueuedTurn ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      data-tooltip="Remover este turno da fila"
                      onClick={() => onCancelQueuedTurn(queued.turnId)}
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>
                <div className="chat-queued-prompt">{queued.prompt}</div>
              </div>
            </div>
          ))}
          {thinking ? (
            <LiveTurnStatus activity={activeTurnActivity(items)} elapsedSec={elapsedSec} />
          ) : null}
        </div>
      </div>
      <div className="chat-composer-wrap">
        {queuedTurns.length > 0 ? (
          <div
            className={
              queuePaused ? 'chat-queue-strip chat-queue-strip-paused' : 'chat-queue-strip'
            }
          >
            <span>
              {queueCountLabel(queuedTurns.length)}
              {queuePaused ? ' · Fila pausada' : ''}
            </span>
            {queuePaused && onResumeQueue ? (
              <button type="button" className="btn btn-sm" onClick={onResumeQueue}>
                Retomar fila
              </button>
            ) : null}
          </div>
        ) : null}
        {busyConflict ? (
          <div className="chat-busy-banner" role="alert">
            <div className="chat-busy-text">
              {busyConflict.exhausted
                ? (busyConflict.message ?? 'Esta conta atingiu o limite de uso.')
                : 'Esta conta está ocupada em outra sessão.'}
            </div>
            <div className="chat-busy-actions">
              {!busyConflict.exhausted && onEnqueuePrompt ? (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  data-tooltip="Enviar este turno quando a conta ficar livre"
                  onClick={() => onEnqueuePrompt({ prompt: busyConflict.prompt })}
                >
                  Enfileirar turno
                </button>
              ) : null}
              {onSwitchAccountAndRetry &&
                alternativeAccounts.slice(0, 3).map((alt) => (
                  <button
                    key={alt.id}
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      onSwitchAccountAndRetry({ accountId: alt.id, prompt: busyConflict.prompt })
                    }
                  >
                    Mover para {PROVIDER_NAME[alt.provider]} · {alt.label}
                  </button>
                ))}
              {onOpenHandoff ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  data-tooltip="Transferir a sessão para outra conta ou provedor"
                  onClick={onOpenHandoff}
                >
                  {t('chat.handoff')}
                </button>
              ) : null}
              {onDismissBusyConflict ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    if (draft.trim() === '' && attachedFiles.length === 0) {
                      editorRef.current?.setMarkdown(busyConflict.prompt);
                    }
                    onDismissBusyConflict();
                  }}
                >
                  Fechar
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {failoverNotice
          ? (() => {
              const failoverBanner = describeFailoverBanner(failoverNotice);
              return (
                <div className="chat-failover-banner" role="status" aria-live="polite">
                  <div className="chat-failover-head">
                    <span className="chat-failover-icon" aria-hidden="true">
                      <AlertIcon size={15} />
                    </span>
                    <div className="chat-busy-text">{failoverBanner.message}</div>
                  </div>
                  <div className="chat-busy-actions">
                    {onAcceptFailover ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        data-tooltip={failoverBanner.acceptTooltip}
                        onClick={onAcceptFailover}
                      >
                        {failoverBanner.acceptLabel}
                      </button>
                    ) : null}
                    {failoverBanner.revertLabel && onRevertFailover ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={running}
                        data-tooltip={
                          running
                            ? 'Aguarde o turno atual terminar para voltar'
                            : (failoverBanner.revertTooltip ?? undefined)
                        }
                        onClick={onRevertFailover}
                      >
                        {failoverBanner.revertLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })()
          : null}
        {popupModel ? <ComposerPopup model={popupModel} /> : null}
        <div className="chat-composer">
          {!readOnly && showFormatToolbar ? (
            <ComposerToolbar active={activeFormats} onFormat={formatDraft} />
          ) : null}
          {attachedFiles.length > 0 ? (
            <div className="chat-composer-files" aria-label="Arquivos anexados">
              {attachedFiles.map((filePath) => (
                <span key={filePath} className="chat-file-tag" title={filePath}>
                  <FileIcon size={12} />
                  <span className="chat-file-tag-path mono">{filePath}</span>
                  <button
                    type="button"
                    className="chat-file-tag-remove"
                    aria-label={`Remover ${filePath}`}
                    data-tooltip="Remover anexo"
                    onClick={() =>
                      setAttachedFiles((current) => current.filter((item) => item !== filePath))
                    }
                  >
                    <CloseIcon size={10} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <DictationStatus dictation={dictation} />
          <RichComposer
            ref={editorRef}
            isMac={IS_MAC}
            readOnly={readOnly}
            placeholder={readOnly ? ARCHIVED_HINT : 'Responda ao agente… (@arquivo, /comando)'}
            onChange={setDraft}
            onCaretChange={syncFromEditor}
            onActiveFormatsChange={setActiveFormats}
            onKeyDown={onKeyDown}
          />
          <div className="chat-composer-bar">
            {readOnly ? null : (
              <>
                <AttachMenu onPick={(kind) => void pickAttachments(kind)} />
                <button
                  type="button"
                  className="chat-format-btn chat-format-toggle"
                  aria-label="Formatação de texto"
                  aria-expanded={showFormatToolbar}
                  aria-pressed={showFormatToolbar}
                  data-tooltip={showFormatToolbar ? 'Ocultar formatação' : 'Formatação de texto'}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setShowFormatToolbar((open) => !open)}
                >
                  <span aria-hidden="true">Aa</span>
                </button>
              </>
            )}
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
                  openRequest={pickerOpenRequest}
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
            {readOnly ? null : <DictationControl dictation={dictation} />}
            {primaryAction === 'stop' ? (
              <button
                type="button"
                className="chat-send chat-send-stop"
                aria-label="Parar"
                data-tooltip={
                  queuedTurns.length > 0
                    ? 'Parar resposta e enviar o próximo da fila'
                    : 'Parar resposta'
                }
                onClick={onCancel}
              >
                <StopFilledIcon size={12} />
              </button>
            ) : (
              <button
                type="button"
                className="chat-send"
                aria-label={primaryAction === 'enqueue' ? 'Adicionar à fila' : 'Enviar mensagem'}
                data-tooltip={primaryAction === 'enqueue' ? 'Adicionar à fila' : 'Enviar mensagem'}
                data-shortcut-text="Enter"
                disabled={readOnly || !hasContent}
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
