import type { ChatItem } from './chat-reducer';

export type ActiveOrchestratorPhase = 'planning' | 'developing' | 'reviewing';

export interface OrchestratorSubsession {
  turnId: string;
  phase: ActiveOrchestratorPhase;
  round: number;
  maxRounds: number;
  orchestratorLabel: string;
  developerLabel: string;
  /** Label of the agent (model) that runs the current phase. */
  agentLabel: string;
  /** Live items (text, thinking, tools) produced by the current phase only. */
  items: ChatItem[];
}

export function orchestratorItemPrefix(input: {
  turnId: string;
  round: number;
  phase: ActiveOrchestratorPhase;
}): string {
  return `orch-${input.turnId}-r${input.round}-${input.phase}-`;
}

/**
 * Returns the sub-session of the orchestration phase that is running now, or
 * `null` when the latest orchestrator step is not an active phase (or a new
 * user turn already started after it).
 */
export function selectOrchestratorSubsession(
  items: readonly ChatItem[],
): OrchestratorSubsession | null {
  let stepIndex = -1;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i]?.type === 'orchestrator') {
      stepIndex = i;
      break;
    }
  }
  const step = items[stepIndex];
  if (step?.type !== 'orchestrator') return null;
  if (step.phase !== 'planning' && step.phase !== 'developing' && step.phase !== 'reviewing') {
    return null;
  }
  const phase = step.phase;
  const prefix = orchestratorItemPrefix({ turnId: step.turnId, round: step.round, phase });
  const phaseItems: ChatItem[] = [];
  for (const item of items.slice(stepIndex + 1)) {
    if (item.type === 'user') return null;
    if (
      (item.type === 'assistant' || item.type === 'thinking' || item.type === 'tool') &&
      // The reducer stores thinking blocks as `thinking-<blockId>`.
      (item.id.startsWith(prefix) || item.id.startsWith(`thinking-${prefix}`))
    ) {
      phaseItems.push(item);
    }
  }
  return {
    turnId: step.turnId,
    phase,
    round: step.round,
    maxRounds: step.maxRounds,
    orchestratorLabel: step.orchestratorLabel,
    developerLabel: step.developerLabel,
    agentLabel: phase === 'developing' ? step.developerLabel : step.orchestratorLabel,
    items: phaseItems,
  };
}
