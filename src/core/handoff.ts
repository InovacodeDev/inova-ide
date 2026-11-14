import type { ChatEvent } from './chat-types.js';
import type { ProviderId } from './types.js';

export const DEFAULT_HANDOFF_MAX_CHARS = 12_000;

// REGEX: matches HTTP 429 and provider quota/rate-limit error strings across CLIs
const RATE_LIMIT_RE =
  /\b429\b|rate[-_ ]?limit|too many requests|usage limit|insufficient quota|quota exceeded|credit balance/i;

export function isRateLimitMessage(text: string): boolean {
  return RATE_LIMIT_RE.test(text);
}

function clip(text: string, maxChars: number): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 1) return normalized.slice(0, Math.max(0, maxChars));
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function collectAssistantTexts(events: readonly ChatEvent[]): string[] {
  const blocks = new Map<string, string>();
  const order: string[] = [];
  for (const event of events) {
    if (event.kind === 'text-delta') {
      if (!blocks.has(event.blockId)) order.push(event.blockId);
      blocks.set(event.blockId, (blocks.get(event.blockId) ?? '') + event.text);
    } else if (event.kind === 'text') {
      if (!blocks.has(event.blockId)) order.push(event.blockId);
      blocks.set(event.blockId, event.text);
    }
  }
  return order.map((id) => (blocks.get(id) ?? '').trim()).filter((text) => text !== '');
}

function collectToolSummaries(events: readonly ChatEvent[]): string[] {
  const summaries: string[] = [];
  for (const event of events) {
    if (event.kind !== 'tool-use') continue;
    const firstLine = event.input.split('\n').find((line) => line.trim() !== '') ?? '';
    summaries.push(`- ${event.name}${firstLine ? `: ${clip(firstLine, 120)}` : ''}`);
  }
  return summaries.slice(-25);
}

function collectErrorsAndFailures(events: readonly ChatEvent[]): string[] {
  const items: string[] = [];
  for (const event of events) {
    if (event.kind === 'error') {
      items.push(`- Erro: ${clip(event.message, 400)}`);
    } else if (event.kind === 'verification' && event.status === 'failed') {
      for (const check of event.checks) {
        if (check.passed) continue;
        const output = check.output.trim();
        items.push(
          `- Verificação falhou (${check.command}): ${output ? clip(output, 400) : `exit ${check.exitCode ?? '?'}`}`,
        );
      }
    }
  }
  return items.slice(-6);
}

export function buildHandoffContext(input: {
  events: readonly ChatEvent[];
  gitSummary?: string;
  fromProvider: ProviderId;
  toProvider: ProviderId;
  maxChars?: number;
}): string {
  const maxChars = Math.max(200, input.maxChars ?? DEFAULT_HANDOFF_MAX_CHARS);
  const userMessages = input.events
    .filter((event): event is Extract<ChatEvent, { kind: 'user' }> => event.kind === 'user')
    .map((event) => event.text.trim())
    .filter((text) => text !== '');
  const assistantTexts = collectAssistantTexts(input.events);
  const toolSummaries = collectToolSummaries(input.events);
  const errors = collectErrorsAndFailures(input.events);

  const sections: string[] = [`[Contexto de handoff: ${input.fromProvider} → ${input.toProvider}]`];

  if (userMessages.length > 0) {
    const first = clip(userMessages[0]!, Math.floor(maxChars * 0.25));
    const followUps = userMessages
      .slice(1)
      .slice(-5)
      .map((msg) => `- ${clip(msg, 300)}`);
    sections.push(
      followUps.length > 0
        ? `## Objetivo original\n${first}\n\n## Pedidos seguintes\n${followUps.join('\n')}`
        : `## Objetivo original\n${first}`,
    );
  }

  if (assistantTexts.length > 0 || toolSummaries.length > 0) {
    const parts: string[] = [];
    if (assistantTexts.length > 0) {
      parts.push(
        assistantTexts
          .slice(-3)
          .map((text) => clip(text, Math.floor(maxChars * 0.2)))
          .join('\n\n'),
      );
    }
    if (toolSummaries.length > 0) {
      parts.push(`Ferramentas usadas:\n${toolSummaries.join('\n')}`);
    }
    sections.push(`## Progresso realizado\n${parts.join('\n\n')}`);
  }

  if (input.gitSummary && input.gitSummary.trim() !== '') {
    sections.push(`## Estado Git atual\n${clip(input.gitSummary, Math.floor(maxChars * 0.2))}`);
  }

  if (errors.length > 0) {
    sections.push(`## Pendências e erros\n${errors.join('\n')}`);
  }

  const combined = sections.join('\n\n');
  return clip(combined, maxChars);
}

export interface TruncatedTranscript {
  kept: ChatEvent[];
  removedUserText: string;
  checkpointRef: string | null;
  skippedLargeFiles: string[];
}

export function truncateTranscriptAtTurn(
  events: readonly ChatEvent[],
  turnIndex: number,
): TruncatedTranscript | null {
  const userIndices: number[] = [];
  for (let i = 0; i < events.length; i += 1) {
    if (events[i]?.kind === 'user') userIndices.push(i);
  }
  const userPos = userIndices[turnIndex];
  if (userPos === undefined) return null;
  const userEvent = events[userPos];
  if (userEvent?.kind !== 'user') return null;
  const prevEvent = userPos > 0 ? events[userPos - 1] : undefined;
  const hasCheckpoint = prevEvent?.kind === 'checkpoint';
  const cut = hasCheckpoint ? userPos - 1 : userPos;
  const earlierFeedback = events
    .slice(cut)
    .filter((event) => event.kind === 'feedback' && event.turnIndex < turnIndex);
  return {
    kept: [...events.slice(0, cut), ...earlierFeedback],
    removedUserText: userEvent.text,
    checkpointRef: hasCheckpoint ? prevEvent.ref : null,
    skippedLargeFiles: hasCheckpoint ? [...prevEvent.skippedLargeFiles] : [],
  };
}

export interface SlicedTranscript {
  slicedEvents: ChatEvent[];
  preTurnCheckpointRef: string | null;
  postTurnCheckpointRef: string | null;
  isLatestTurn: boolean;
}

export function sliceTranscriptToTurn(
  events: readonly ChatEvent[],
  turnIndex: number,
): SlicedTranscript {
  const userIndices: number[] = [];
  for (let i = 0; i < events.length; i += 1) {
    if (events[i]?.kind === 'user') userIndices.push(i);
  }
  if (userIndices.length === 0) {
    return {
      slicedEvents: [...events],
      preTurnCheckpointRef: null,
      postTurnCheckpointRef: null,
      isLatestTurn: true,
    };
  }
  const boundedTurn = Math.max(0, Math.min(turnIndex, userIndices.length - 1));
  const targetUserPos = userIndices[boundedTurn]!;
  const prevEvent = targetUserPos > 0 ? events[targetUserPos - 1] : undefined;
  const preTurnCheckpointRef = prevEvent?.kind === 'checkpoint' ? prevEvent.ref : null;
  const isLatestTurn = boundedTurn === userIndices.length - 1;

  if (isLatestTurn) {
    return {
      slicedEvents: [...events],
      preTurnCheckpointRef,
      postTurnCheckpointRef: null,
      isLatestTurn: true,
    };
  }

  const nextUserPos = userIndices[boundedTurn + 1]!;
  const beforeNextUser = nextUserPos > 0 ? events[nextUserPos - 1] : undefined;
  const hasPostCheckpoint = beforeNextUser?.kind === 'checkpoint';
  const cutEnd = hasPostCheckpoint ? nextUserPos - 1 : nextUserPos;
  return {
    slicedEvents: events.slice(0, cutEnd),
    preTurnCheckpointRef,
    postTurnCheckpointRef: hasPostCheckpoint ? beforeNextUser.ref : null,
    isLatestTurn: false,
  };
}
