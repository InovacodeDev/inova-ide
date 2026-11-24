import type { ChatEvent } from '@inova/core/chat-types';
import { tryRunGit } from '@inova/core/git-exec';
import type { ChatTurn } from '@inova/core/launch';
import { PROVIDER_MODELS, type ProviderModels } from '@inova/core/models';
import { MAX_ORCHESTRATOR_DIFF_CHARS } from '@inova/core/orchestrator';
import type { Account, EffortLevel, ExecutionMode, ProviderId } from '@inova/core/types';

export interface OrchestrationAgentRuntime {
  account: Account;
  file: string;
  model: string | null;
  effort: EffortLevel | null;
  executionMode: ExecutionMode;
  providerSessionId: string | null;
  label: string;
  provisionalSessionId: string | null;
  provisionalConfirmed: boolean;
}

export interface OrchestrationTurnState {
  turnId: string;
  sessionId: string;
  cwd: string;
  userPrompt: string;
  contextPrefix: string;
  baseEnv: NodeJS.ProcessEnv;
  extraDirs: readonly string[];
  disabledSkillIds: readonly string[];
  phase: 'planning' | 'developing' | 'reviewing';
  round: number;
  maxRounds: number;
  lastPlan: string;
  phaseBlocks: Map<string, string>;
  phaseBlockOrder: string[];
  totalCostUsd: number | null;
  totalDurationMs: number | null;
  usage: {
    hasUsage: boolean;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  cancelled: boolean;
  /** The user asked to end the developer phase now and move on to the review. */
  skipRequested: boolean;
  transitioning: boolean;
  orch: OrchestrationAgentRuntime;
  dev: OrchestrationAgentRuntime;
  devInitialTurn: ChatTurn | null;
}

const PROVIDER_DISPLAY_NAMES: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  grok: 'Grok',
  qwen: 'Qwen',
  opencode: 'OpenCode',
};

export function formatAgentModelLabel(input: {
  provider: ProviderId;
  model: string | null;
  catalog?: ProviderModels;
}): string {
  const catalog = input.catalog ?? PROVIDER_MODELS[input.provider];
  if (input.model === null) {
    return `${PROVIDER_DISPLAY_NAMES[input.provider]} (${catalog.defaultModelLabel})`;
  }
  const matched = catalog.models.find((item) => item.id === input.model);
  return matched?.label ?? input.model;
}

export function createOrchestrationState(input: {
  turnId: string;
  sessionId: string;
  cwd: string;
  userPrompt: string;
  contextPrefix: string;
  baseEnv: NodeJS.ProcessEnv;
  extraDirs: readonly string[];
  disabledSkillIds?: readonly string[];
  maxRounds: number;
  orch: OrchestrationAgentRuntime;
  dev: OrchestrationAgentRuntime;
  devInitialTurn?: ChatTurn | null;
}): OrchestrationTurnState {
  return {
    turnId: input.turnId,
    sessionId: input.sessionId,
    cwd: input.cwd,
    userPrompt: input.userPrompt,
    contextPrefix: input.contextPrefix,
    baseEnv: input.baseEnv,
    extraDirs: [...input.extraDirs],
    disabledSkillIds: [...(input.disabledSkillIds ?? [])],
    phase: 'planning',
    round: 1,
    maxRounds: input.maxRounds,
    lastPlan: '',
    phaseBlocks: new Map(),
    phaseBlockOrder: [],
    totalCostUsd: null,
    totalDurationMs: null,
    usage: {
      hasUsage: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    cancelled: false,
    skipRequested: false,
    transitioning: false,
    orch: input.orch,
    dev: input.dev,
    devInitialTurn: input.devInitialTurn ?? null,
  };
}

export function activeAgentOf(state: OrchestrationTurnState): OrchestrationAgentRuntime {
  return state.phase === 'developing' ? state.dev : state.orch;
}

export function clearPhaseOutput(state: OrchestrationTurnState): void {
  state.phaseBlocks.clear();
  state.phaseBlockOrder = [];
}

export function recordPhaseTextEvent(state: OrchestrationTurnState, event: ChatEvent): void {
  if (event.kind === 'text-delta') {
    if (!state.phaseBlocks.has(event.blockId)) {
      state.phaseBlockOrder.push(event.blockId);
    }
    state.phaseBlocks.set(event.blockId, (state.phaseBlocks.get(event.blockId) ?? '') + event.text);
  } else if (event.kind === 'text') {
    if (!state.phaseBlocks.has(event.blockId)) {
      state.phaseBlockOrder.push(event.blockId);
    }
    state.phaseBlocks.set(event.blockId, event.text);
  }
}

export function readPhaseText(state: OrchestrationTurnState): string {
  return state.phaseBlockOrder
    .map((id) => state.phaseBlocks.get(id) ?? '')
    .filter((chunk) => chunk !== '')
    .join('\n\n')
    .trim();
}

export function prefixOrchestrationEvent(
  state: OrchestrationTurnState,
  event: ChatEvent,
): ChatEvent {
  const prefix = `orch-${state.turnId}-r${state.round}-${state.phase}-`;
  switch (event.kind) {
    case 'text':
    case 'text-delta':
    case 'thinking':
    case 'thinking-delta':
      return { ...event, blockId: `${prefix}${event.blockId}` };
    case 'tool-use':
    case 'tool-result':
    case 'subagent':
      return { ...event, toolId: `${prefix}${event.toolId}` };
    case 'session':
    case 'user':
    case 'usage-limits':
    case 'context':
    case 'turn-usage':
    case 'checkpoint':
    case 'verification':
    case 'orchestrator':
    case 'feedback':
    case 'error':
    case 'done':
      return event;
  }
}

export function accumulateOrchestrationUsage(
  state: OrchestrationTurnState,
  event: Extract<ChatEvent, { kind: 'turn-usage' }>,
): void {
  state.usage.hasUsage = true;
  state.usage.inputTokens += event.inputTokens;
  state.usage.outputTokens += event.outputTokens;
  state.usage.cacheReadTokens += event.cacheReadTokens;
  state.usage.cacheWriteTokens += event.cacheWriteTokens;
}

export function accumulateOrchestrationDone(
  state: OrchestrationTurnState,
  event: Extract<ChatEvent, { kind: 'done' }>,
): void {
  if (event.costUsd !== null) {
    state.totalCostUsd = (state.totalCostUsd ?? 0) + event.costUsd;
  }
  if (event.durationMs !== null) {
    state.totalDurationMs = (state.totalDurationMs ?? 0) + event.durationMs;
  }
}

export async function readOrchestratorGitSummary(cwd: string): Promise<string> {
  const [status, stat, diff] = await Promise.all([
    tryRunGit({ cwd, args: ['status', '--short'] }),
    tryRunGit({ cwd, args: ['diff', '--stat'] }),
    tryRunGit({ cwd, args: ['diff'] }),
  ]);
  const parts: string[] = [];
  if (status.ok && status.stdout.trim() !== '') {
    parts.push(`git status --short:\n${status.stdout.trim()}`);
  }
  if (stat.ok && stat.stdout.trim() !== '') {
    parts.push(`git diff --stat:\n${stat.stdout.trim()}`);
  }
  if (diff.ok && diff.stdout.trim() !== '') {
    parts.push(`git diff:\n${diff.stdout.trim()}`);
  }
  const combined = parts.join('\n\n');
  if (combined.length <= MAX_ORCHESTRATOR_DIFF_CHARS) return combined;
  return `${combined.slice(0, MAX_ORCHESTRATOR_DIFF_CHARS - 1)}…`;
}
