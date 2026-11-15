import type { ChatEvent, TurnTokenUsage } from './chat-types.js';
import type { SessionUsageTotals } from './types.js';

export const EMPTY_SESSION_USAGE_TOTALS: SessionUsageTotals = {
  costUsd: 0,
  costTurns: 0,
  turns: 0,
  durationMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export interface TurnUsageEntry extends TurnTokenUsage {
  turnIndex: number;
  promptPreview: string;
  isError: boolean;
  costUsd: number | null;
  durationMs: number | null;
}

export interface TurnCostDelta {
  costUsd: number | null;
  durationMs: number | null;
  usage?: TurnTokenUsage | null;
}

const USAGE_NUMBER_KEYS: readonly (keyof SessionUsageTotals)[] = [
  'costUsd',
  'costTurns',
  'turns',
  'durationMs',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function isSessionUsageTotals(value: unknown): value is SessionUsageTotals {
  if (!isRecord(value)) return false;
  return USAGE_NUMBER_KEYS.every((key) => num(value[key]) !== null);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function addTurnToUsageTotals(
  totals: SessionUsageTotals,
  turn: TurnCostDelta,
): SessionUsageTotals {
  const hasCost = turn.costUsd !== null && Number.isFinite(turn.costUsd) && turn.costUsd >= 0;
  const costDelta = hasCost ? (turn.costUsd ?? 0) : 0;
  const durationDelta =
    turn.durationMs !== null && Number.isFinite(turn.durationMs) && turn.durationMs > 0
      ? turn.durationMs
      : 0;
  const usage = turn.usage;
  return {
    costUsd: roundUsd(totals.costUsd + costDelta),
    costTurns: totals.costTurns + (hasCost ? 1 : 0),
    turns: totals.turns + 1,
    durationMs: totals.durationMs + durationDelta,
    inputTokens: totals.inputTokens + (usage?.inputTokens ?? 0),
    outputTokens: totals.outputTokens + (usage?.outputTokens ?? 0),
    cacheReadTokens: totals.cacheReadTokens + (usage?.cacheReadTokens ?? 0),
    cacheWriteTokens: totals.cacheWriteTokens + (usage?.cacheWriteTokens ?? 0),
  };
}

export function sumSessionUsageTotals(
  items: readonly (SessionUsageTotals | null | undefined)[],
): SessionUsageTotals {
  const sum = { ...EMPTY_SESSION_USAGE_TOTALS };
  for (const item of items) {
    if (!item) continue;
    sum.costUsd = roundUsd(sum.costUsd + item.costUsd);
    sum.costTurns += item.costTurns;
    sum.turns += item.turns;
    sum.durationMs += item.durationMs;
    sum.inputTokens += item.inputTokens;
    sum.outputTokens += item.outputTokens;
    sum.cacheReadTokens += item.cacheReadTokens;
    sum.cacheWriteTokens += item.cacheWriteTokens;
  }
  return sum;
}

function promptPreviewOf(text: string): string {
  const firstLine =
    text
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? '';
  if (firstLine.length <= 72) return firstLine;
  return `${firstLine.slice(0, 71)}…`;
}

export function aggregateTranscriptUsage(events: readonly ChatEvent[]): {
  totals: SessionUsageTotals;
  turnEntries: TurnUsageEntry[];
} {
  let totals = { ...EMPTY_SESSION_USAGE_TOTALS };
  const turnEntries: TurnUsageEntry[] = [];
  let turnIndex = -1;
  let currentPrompt = '';
  let currentUsage: TurnTokenUsage | null = null;

  for (const event of events) {
    if (event.kind === 'user') {
      turnIndex += 1;
      currentPrompt = promptPreviewOf(event.text);
      currentUsage = null;
      continue;
    }
    if (event.kind === 'turn-usage') {
      currentUsage = {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens,
        cacheWriteTokens: event.cacheWriteTokens,
      };
      continue;
    }
    if (event.kind === 'done') {
      const entry: TurnUsageEntry = {
        turnIndex: Math.max(0, turnIndex),
        promptPreview: currentPrompt,
        isError: event.isError,
        costUsd: event.costUsd,
        durationMs: event.durationMs,
        inputTokens: currentUsage?.inputTokens ?? 0,
        outputTokens: currentUsage?.outputTokens ?? 0,
        cacheReadTokens: currentUsage?.cacheReadTokens ?? 0,
        cacheWriteTokens: currentUsage?.cacheWriteTokens ?? 0,
      };
      turnEntries.push(entry);
      totals = addTurnToUsageTotals(totals, {
        costUsd: event.costUsd,
        durationMs: event.durationMs,
        usage: currentUsage,
      });
      currentUsage = null;
    }
  }

  return { totals, turnEntries };
}

function usageFromRecord(usage: unknown): TurnTokenUsage | null {
  if (!isRecord(usage)) return null;
  const cacheObj = isRecord(usage['cache']) ? usage['cache'] : null;
  const promptDetails = isRecord(usage['prompt_tokens_details'])
    ? usage['prompt_tokens_details']
    : null;

  const anthropicCacheRead = num(usage['cache_read_input_tokens']);
  const anthropicCacheWrite = num(usage['cache_creation_input_tokens']);
  const codexCachedInput =
    num(usage['cached_input_tokens']) ?? num(usage['cached_tokens']) ?? num(usage['cached']);
  const openCodeInput = num(usage['input']);
  const openCodeOutput = num(usage['output']);
  const rawInput = num(usage['input_tokens']);
  const promptTokens = num(usage['prompt_tokens']);
  const rawOutput = num(usage['output_tokens']);
  const completionTokens = num(usage['completion_tokens']);

  if (openCodeInput !== null || openCodeOutput !== null || cacheObj !== null) {
    return {
      inputTokens: openCodeInput ?? 0,
      outputTokens: openCodeOutput ?? 0,
      cacheReadTokens: num(cacheObj?.['read']) ?? 0,
      cacheWriteTokens: num(cacheObj?.['write']) ?? 0,
    };
  }

  if (
    rawInput !== null ||
    rawOutput !== null ||
    anthropicCacheRead !== null ||
    anthropicCacheWrite !== null
  ) {
    if (anthropicCacheRead !== null || anthropicCacheWrite !== null) {
      return {
        inputTokens: rawInput ?? 0,
        outputTokens: rawOutput ?? 0,
        cacheReadTokens: anthropicCacheRead ?? 0,
        cacheWriteTokens: anthropicCacheWrite ?? 0,
      };
    }
    const cacheRead = codexCachedInput ?? 0;
    return {
      inputTokens: Math.max(0, (rawInput ?? 0) - cacheRead),
      outputTokens: rawOutput ?? 0,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: 0,
    };
  }

  if (promptTokens !== null || completionTokens !== null) {
    const cacheRead = num(promptDetails?.['cached_tokens']) ?? num(usage['cached_tokens']) ?? 0;
    return {
      inputTokens: Math.max(0, (promptTokens ?? 0) - cacheRead),
      outputTokens: completionTokens ?? rawOutput ?? 0,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: 0,
    };
  }

  return null;
}

export function extractTurnUsageFromLine(line: string): TurnTokenUsage | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  if (parsed['type'] === 'result' && (parsed['parent_tool_use_id'] ?? null) === null) {
    return usageFromRecord(parsed['usage']);
  }
  if (parsed['type'] === 'turn.completed') {
    return usageFromRecord(parsed['usage']);
  }
  if (parsed['type'] === 'step_finish' && isRecord(parsed['part'])) {
    const reason = parsed['part']['reason'];
    if (reason === 'stop' || reason === null || reason === undefined) {
      return usageFromRecord(parsed['part']['tokens']);
    }
  }
  if (parsed['event'] === 'result' && isRecord(parsed['result'])) {
    return usageFromRecord(parsed['result']['stats'] ?? parsed['result']['usage']);
  }
  return null;
}

export function formatCostUsd(costUsd: number | null | undefined): string {
  if (costUsd === null || costUsd === undefined || !Number.isFinite(costUsd)) return '—';
  return `$${costUsd.toFixed(4)}`;
}
