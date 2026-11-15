import type {
  MaxConsecutiveToolErrors,
  MaxConsecutiveVerificationFailures,
  MaxContextPercent,
  MaxSessionCostUsd,
} from './types.js';

export const CIRCUIT_BREAKER_PREFIX = 'CIRCUIT_BREAKER:';
export const IDENTICAL_TOOL_ERROR_LIMIT = 3;
const MAX_SIGNATURE_OUTPUT_CHARS = 300;

export interface CircuitBreakerLimits {
  maxConsecutiveToolErrors: MaxConsecutiveToolErrors;
  maxConsecutiveVerificationFailures: MaxConsecutiveVerificationFailures;
  maxSessionCostUsd: MaxSessionCostUsd;
  maxContextPercent: MaxContextPercent;
}

export function isCircuitBreakerMessage(text: string): boolean {
  return text.trimStart().startsWith(CIRCUIT_BREAKER_PREFIX);
}

interface SessionCircuitState {
  toolNamesById: Map<string, string>;
  consecutiveToolErrors: number;
  lastToolErrorSignature: string | null;
  identicalToolErrorStreak: number;
  consecutiveVerificationFailures: number;
  totalCostUsd: number;
  acknowledgedCostUsd: number;
  lastContextPercent: number;
  toolTrippedInTurn: boolean;
  contextTrippedInTurn: boolean;
  activeTurnTripReason: string | null;
  trippedReason: string | null;
}

function createInitialState(): SessionCircuitState {
  return {
    toolNamesById: new Map(),
    consecutiveToolErrors: 0,
    lastToolErrorSignature: null,
    identicalToolErrorStreak: 0,
    consecutiveVerificationFailures: 0,
    totalCostUsd: 0,
    acknowledgedCostUsd: 0,
    lastContextPercent: 0,
    toolTrippedInTurn: false,
    contextTrippedInTurn: false,
    activeTurnTripReason: null,
    trippedReason: null,
  };
}

function normalizeErrorOutput(output: string): string {
  return output.trim().replace(/\s+/g, ' ').slice(0, MAX_SIGNATURE_OUTPUT_CHARS);
}

function formatUsd(amount: number): string {
  return amount.toFixed(2);
}

export interface CircuitBreakerTracker {
  startTurn(sessionId: string): void;
  recordToolUse(input: { sessionId: string; toolId: string; name: string }): void;
  recordToolResult(input: {
    sessionId: string;
    toolId: string;
    output: string;
    isError: boolean;
    limits: CircuitBreakerLimits;
  }): string | null;
  recordContext(input: {
    sessionId: string;
    usedTokens: number;
    windowTokens: number | null;
    limits: CircuitBreakerLimits;
  }): string | null;
  recordDone(input: { sessionId: string; costUsd: number | null; limits: CircuitBreakerLimits }): {
    costTripReason: string | null;
    turnTripReason: string | null;
  };
  recordVerification(input: {
    sessionId: string;
    status: 'running' | 'passed' | 'failed' | 'skipped';
    limits: CircuitBreakerLimits;
  }): string | null;
  checkCostLimit(input: { sessionId: string; limits: CircuitBreakerLimits }): string | null;
  resetManual(sessionId: string): void;
  deleteSession(sessionId: string): void;
}

export function createCircuitBreakerTracker(): CircuitBreakerTracker {
  const sessions = new Map<string, SessionCircuitState>();

  function getOrCreate(sessionId: string): SessionCircuitState {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const created = createInitialState();
    sessions.set(sessionId, created);
    return created;
  }

  return {
    startTurn(sessionId) {
      const state = getOrCreate(sessionId);
      state.toolNamesById.clear();
      state.consecutiveToolErrors = 0;
      state.lastToolErrorSignature = null;
      state.identicalToolErrorStreak = 0;
      state.toolTrippedInTurn = false;
      state.contextTrippedInTurn = false;
      state.activeTurnTripReason = null;
    },

    recordToolUse(input) {
      const state = getOrCreate(input.sessionId);
      state.toolNamesById.set(input.toolId, input.name);
    },

    recordToolResult(input) {
      const state = getOrCreate(input.sessionId);
      if (!input.isError) {
        state.consecutiveToolErrors = 0;
        state.lastToolErrorSignature = null;
        state.identicalToolErrorStreak = 0;
        return null;
      }
      state.consecutiveToolErrors += 1;
      const toolName = state.toolNamesById.get(input.toolId) ?? 'ferramenta';
      const normalized = normalizeErrorOutput(input.output);
      const signature = normalized === '' ? null : `${toolName}:${normalized}`;
      if (signature !== null && signature === state.lastToolErrorSignature) {
        state.identicalToolErrorStreak += 1;
      } else {
        state.lastToolErrorSignature = signature;
        state.identicalToolErrorStreak = signature === null ? 0 : 1;
      }

      const maxErrors = input.limits.maxConsecutiveToolErrors;
      if (maxErrors === 0 || state.toolTrippedInTurn) return null;

      const identicalThreshold = Math.min(IDENTICAL_TOOL_ERROR_LIMIT, maxErrors);
      if (state.identicalToolErrorStreak >= identicalThreshold) {
        const reason = `${CIRCUIT_BREAKER_PREFIX} A ferramenta ${toolName} repetiu o mesmo erro ${state.identicalToolErrorStreak} vezes seguidas. Turno interrompido.`;
        state.toolTrippedInTurn = true;
        state.activeTurnTripReason = reason;
        state.trippedReason = reason;
        return reason;
      }

      if (state.consecutiveToolErrors >= maxErrors) {
        const reason = `${CIRCUIT_BREAKER_PREFIX} Limite de ${maxErrors} erros seguidos de ferramenta atingido. Turno interrompido.`;
        state.toolTrippedInTurn = true;
        state.activeTurnTripReason = reason;
        state.trippedReason = reason;
        return reason;
      }

      return null;
    },

    recordContext(input) {
      const state = getOrCreate(input.sessionId);
      if (input.windowTokens === null || input.windowTokens <= 0) return null;
      const percent = Math.round((input.usedTokens / input.windowTokens) * 100);
      state.lastContextPercent = percent;
      const maxPercent = input.limits.maxContextPercent;
      if (maxPercent === 0 || state.contextTrippedInTurn) return null;
      if (percent >= maxPercent) {
        const reason = `${CIRCUIT_BREAKER_PREFIX} Uso de contexto atingiu ${percent}% (limite: ${maxPercent}%). Sessão pausada.`;
        state.contextTrippedInTurn = true;
        state.activeTurnTripReason = reason;
        state.trippedReason = reason;
        return reason;
      }
      return null;
    },

    recordDone(input) {
      const state = getOrCreate(input.sessionId);
      state.toolNamesById.clear();
      state.consecutiveToolErrors = 0;
      state.lastToolErrorSignature = null;
      state.identicalToolErrorStreak = 0;
      state.toolTrippedInTurn = false;
      state.contextTrippedInTurn = false;

      let costTripReason: string | null = null;
      if (input.costUsd !== null && Number.isFinite(input.costUsd) && input.costUsd > 0) {
        state.totalCostUsd =
          Math.round((state.totalCostUsd + input.costUsd) * 1_000_000) / 1_000_000;
      }
      const maxCost = input.limits.maxSessionCostUsd;
      if (
        maxCost > 0 &&
        state.totalCostUsd >= maxCost &&
        state.totalCostUsd > state.acknowledgedCostUsd
      ) {
        costTripReason = `${CIRCUIT_BREAKER_PREFIX} Custo acumulado da sessão ($${formatUsd(state.totalCostUsd)}) atingiu o limite de $${maxCost}. Sessão pausada.`;
        state.activeTurnTripReason = costTripReason;
        state.trippedReason = costTripReason;
      }

      const turnTripReason = state.activeTurnTripReason;
      state.activeTurnTripReason = null;
      return { costTripReason, turnTripReason };
    },

    recordVerification(input) {
      const state = getOrCreate(input.sessionId);
      if (input.status === 'passed') {
        state.consecutiveVerificationFailures = 0;
        return null;
      }
      if (input.status !== 'failed') return null;
      state.consecutiveVerificationFailures += 1;
      const maxFailures = input.limits.maxConsecutiveVerificationFailures;
      if (maxFailures === 0) return null;
      if (state.consecutiveVerificationFailures >= maxFailures) {
        const reason = `${CIRCUIT_BREAKER_PREFIX} Verificação pós-turno falhou ${state.consecutiveVerificationFailures} vezes seguidas. Sessão pausada.`;
        state.consecutiveVerificationFailures = 0;
        state.trippedReason = reason;
        return reason;
      }
      return null;
    },

    checkCostLimit(input) {
      const state = getOrCreate(input.sessionId);
      const maxCost = input.limits.maxSessionCostUsd;
      if (
        maxCost > 0 &&
        state.totalCostUsd >= maxCost &&
        state.totalCostUsd > state.acknowledgedCostUsd
      ) {
        const reason = `${CIRCUIT_BREAKER_PREFIX} Custo acumulado da sessão ($${formatUsd(state.totalCostUsd)}) atingiu o limite de $${maxCost}. Sessão pausada.`;
        state.trippedReason = reason;
        return reason;
      }
      return null;
    },

    resetManual(sessionId) {
      const state = sessions.get(sessionId);
      if (!state) return;
      state.consecutiveToolErrors = 0;
      state.lastToolErrorSignature = null;
      state.identicalToolErrorStreak = 0;
      state.consecutiveVerificationFailures = 0;
      state.acknowledgedCostUsd = state.totalCostUsd;
      state.toolTrippedInTurn = false;
      state.contextTrippedInTurn = false;
      state.activeTurnTripReason = null;
      state.trippedReason = null;
    },

    deleteSession(sessionId) {
      sessions.delete(sessionId);
    },
  };
}
