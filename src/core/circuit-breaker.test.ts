import { describe, expect, it } from 'vitest';
import {
  CIRCUIT_BREAKER_PREFIX,
  createCircuitBreakerTracker,
  isCircuitBreakerMessage,
  type CircuitBreakerLimits,
} from './circuit-breaker.js';

const DEFAULT_LIMITS: CircuitBreakerLimits = {
  maxConsecutiveToolErrors: 5,
  maxConsecutiveVerificationFailures: 3,
  maxSessionCostUsd: 5,
  maxContextPercent: 90,
};

describe('circuit breaker', () => {
  it('identifies circuit breaker messages by prefix', () => {
    expect(isCircuitBreakerMessage(`${CIRCUIT_BREAKER_PREFIX} Limite atingido.`)).toBe(true);
    expect(isCircuitBreakerMessage(`  ${CIRCUIT_BREAKER_PREFIX} Turno parado.`)).toBe(true);
    expect(isCircuitBreakerMessage('RATE_LIMIT: tente mais tarde.')).toBe(false);
    expect(isCircuitBreakerMessage('circuit_breaker: minusculo')).toBe(false);
    expect(isCircuitBreakerMessage('')).toBe(false);
  });

  it('trips on N consecutive tool errors and trips at most once per turn', () => {
    const tracker = createCircuitBreakerTracker();
    tracker.startTurn('s1');

    for (let index = 1; index <= 4; index += 1) {
      tracker.recordToolUse({ sessionId: 's1', toolId: `t${index}`, name: 'Bash' });
      expect(
        tracker.recordToolResult({
          sessionId: 's1',
          toolId: `t${index}`,
          output: `falha distinta ${index}`,
          isError: true,
          limits: DEFAULT_LIMITS,
        }),
      ).toBeNull();
    }

    tracker.recordToolUse({ sessionId: 's1', toolId: 't5', name: 'Bash' });
    const tripped = tracker.recordToolResult({
      sessionId: 's1',
      toolId: 't5',
      output: 'falha distinta 5',
      isError: true,
      limits: DEFAULT_LIMITS,
    });
    expect(tripped).toContain(CIRCUIT_BREAKER_PREFIX);
    expect(tripped).toContain('5 erros seguidos');

    tracker.recordToolUse({ sessionId: 's1', toolId: 't6', name: 'Bash' });
    expect(
      tracker.recordToolResult({
        sessionId: 's1',
        toolId: 't6',
        output: 'falha distinta 6',
        isError: true,
        limits: DEFAULT_LIMITS,
      }),
    ).toBeNull();
  });

  it('trips early on 3 identical normalized errors from the same tool', () => {
    const tracker = createCircuitBreakerTracker();
    tracker.startTurn('s1');

    const outputs = [
      '  ENOENT:\n  missing file  ',
      'ENOENT: missing   file',
      'ENOENT: missing file',
    ];
    outputs.forEach((output, index) => {
      const toolId = `t${index}`;
      tracker.recordToolUse({ sessionId: 's1', toolId, name: 'Read' });
      const result = tracker.recordToolResult({
        sessionId: 's1',
        toolId,
        output,
        isError: true,
        limits: DEFAULT_LIMITS,
      });
      if (index < 2) {
        expect(result).toBeNull();
      } else {
        expect(result).toContain(CIRCUIT_BREAKER_PREFIX);
        expect(result).toContain('Read repetiu o mesmo erro 3 vezes');
      }
    });
  });

  it('does not count identical output across different tools or empty output as identical streak', () => {
    const tracker = createCircuitBreakerTracker();
    tracker.startTurn('s1');

    const tools = ['Read', 'Write', 'Edit'];
    tools.forEach((name, index) => {
      const toolId = `d${index}`;
      tracker.recordToolUse({ sessionId: 's1', toolId, name });
      expect(
        tracker.recordToolResult({
          sessionId: 's1',
          toolId,
          output: 'permission denied',
          isError: true,
          limits: DEFAULT_LIMITS,
        }),
      ).toBeNull();
    });

    tracker.startTurn('s2');
    for (let index = 0; index < 3; index += 1) {
      tracker.recordToolUse({ sessionId: 's2', toolId: `e${index}`, name: 'Bash' });
      expect(
        tracker.recordToolResult({
          sessionId: 's2',
          toolId: `e${index}`,
          output: '   ',
          isError: true,
          limits: DEFAULT_LIMITS,
        }),
      ).toBeNull();
    }
  });

  it('resets tool error streak on success and when maxConsecutiveToolErrors is 0', () => {
    const tracker = createCircuitBreakerTracker();
    tracker.startTurn('s1');

    for (let index = 0; index < 2; index += 1) {
      tracker.recordToolUse({ sessionId: 's1', toolId: `a${index}`, name: 'Bash' });
      expect(
        tracker.recordToolResult({
          sessionId: 's1',
          toolId: `a${index}`,
          output: 'same error',
          isError: true,
          limits: DEFAULT_LIMITS,
        }),
      ).toBeNull();
    }

    tracker.recordToolUse({ sessionId: 's1', toolId: 'ok', name: 'Bash' });
    expect(
      tracker.recordToolResult({
        sessionId: 's1',
        toolId: 'ok',
        output: 'ok',
        isError: false,
        limits: DEFAULT_LIMITS,
      }),
    ).toBeNull();

    for (let index = 0; index < 10; index += 1) {
      tracker.recordToolUse({ sessionId: 's1', toolId: `u${index}`, name: 'Bash' });
      expect(
        tracker.recordToolResult({
          sessionId: 's1',
          toolId: `u${index}`,
          output: 'same error',
          isError: true,
          limits: { ...DEFAULT_LIMITS, maxConsecutiveToolErrors: 0 },
        }),
      ).toBeNull();
    }
  });

  it('trips on consecutive verification failures and resets on pass, trip, or 0 limit', () => {
    const tracker = createCircuitBreakerTracker();

    expect(
      tracker.recordVerification({ sessionId: 's1', status: 'failed', limits: DEFAULT_LIMITS }),
    ).toBeNull();
    expect(
      tracker.recordVerification({ sessionId: 's1', status: 'running', limits: DEFAULT_LIMITS }),
    ).toBeNull();
    expect(
      tracker.recordVerification({ sessionId: 's1', status: 'skipped', limits: DEFAULT_LIMITS }),
    ).toBeNull();
    expect(
      tracker.recordVerification({ sessionId: 's1', status: 'failed', limits: DEFAULT_LIMITS }),
    ).toBeNull();
    expect(
      tracker.recordVerification({ sessionId: 's1', status: 'passed', limits: DEFAULT_LIMITS }),
    ).toBeNull();

    expect(
      tracker.recordVerification({ sessionId: 's1', status: 'failed', limits: DEFAULT_LIMITS }),
    ).toBeNull();
    expect(
      tracker.recordVerification({ sessionId: 's1', status: 'failed', limits: DEFAULT_LIMITS }),
    ).toBeNull();
    const tripped = tracker.recordVerification({
      sessionId: 's1',
      status: 'failed',
      limits: DEFAULT_LIMITS,
    });
    expect(tripped).toContain(CIRCUIT_BREAKER_PREFIX);
    expect(tripped).toContain('3 vezes seguidas');

    expect(
      tracker.recordVerification({ sessionId: 's1', status: 'failed', limits: DEFAULT_LIMITS }),
    ).toBeNull();

    const unlimited = { ...DEFAULT_LIMITS, maxConsecutiveVerificationFailures: 0 as const };
    for (let index = 0; index < 5; index += 1) {
      expect(
        tracker.recordVerification({ sessionId: 's2', status: 'failed', limits: unlimited }),
      ).toBeNull();
    }
  });

  it('tracks session cost, reports turn trip once, and handles resetManual ack', () => {
    const tracker = createCircuitBreakerTracker();
    tracker.startTurn('s1');

    expect(tracker.recordDone({ sessionId: 's1', costUsd: null, limits: DEFAULT_LIMITS })).toEqual({
      costTripReason: null,
      turnTripReason: null,
    });
    expect(tracker.recordDone({ sessionId: 's1', costUsd: 2.5, limits: DEFAULT_LIMITS })).toEqual({
      costTripReason: null,
      turnTripReason: null,
    });
    expect(tracker.checkCostLimit({ sessionId: 's1', limits: DEFAULT_LIMITS })).toBeNull();

    const third = tracker.recordDone({ sessionId: 's1', costUsd: 2.5, limits: DEFAULT_LIMITS });
    expect(third.costTripReason).toContain(CIRCUIT_BREAKER_PREFIX);
    expect(third.costTripReason).toContain('$5.00');
    expect(third.turnTripReason).toBe(third.costTripReason);
    expect(tracker.checkCostLimit({ sessionId: 's1', limits: DEFAULT_LIMITS })).toBe(
      third.costTripReason,
    );

    tracker.resetManual('s1');
    expect(tracker.checkCostLimit({ sessionId: 's1', limits: DEFAULT_LIMITS })).toBeNull();

    const next = tracker.recordDone({ sessionId: 's1', costUsd: 0.25, limits: DEFAULT_LIMITS });
    expect(next.costTripReason).toContain('$5.25');

    expect(
      tracker.checkCostLimit({
        sessionId: 's1',
        limits: { ...DEFAULT_LIMITS, maxSessionCostUsd: 0 },
      }),
    ).toBeNull();
  });

  it('tracks context percentage once per turn and guards null or disabled limits', () => {
    const tracker = createCircuitBreakerTracker();
    tracker.startTurn('s1');

    expect(
      tracker.recordContext({
        sessionId: 's1',
        usedTokens: 90_000,
        windowTokens: null,
        limits: DEFAULT_LIMITS,
      }),
    ).toBeNull();
    expect(
      tracker.recordContext({
        sessionId: 's1',
        usedTokens: 90_000,
        windowTokens: 0,
        limits: DEFAULT_LIMITS,
      }),
    ).toBeNull();
    expect(
      tracker.recordContext({
        sessionId: 's1',
        usedTokens: 89_000,
        windowTokens: 100_000,
        limits: DEFAULT_LIMITS,
      }),
    ).toBeNull();

    const tripped = tracker.recordContext({
      sessionId: 's1',
      usedTokens: 90_000,
      windowTokens: 100_000,
      limits: DEFAULT_LIMITS,
    });
    expect(tripped).toContain(CIRCUIT_BREAKER_PREFIX);
    expect(tripped).toContain('90%');

    expect(
      tracker.recordContext({
        sessionId: 's1',
        usedTokens: 95_000,
        windowTokens: 100_000,
        limits: DEFAULT_LIMITS,
      }),
    ).toBeNull();

    const done = tracker.recordDone({ sessionId: 's1', costUsd: 0.1, limits: DEFAULT_LIMITS });
    expect(done.turnTripReason).toBe(tripped);

    tracker.startTurn('s2');
    expect(
      tracker.recordContext({
        sessionId: 's2',
        usedTokens: 99_000,
        windowTokens: 100_000,
        limits: { ...DEFAULT_LIMITS, maxContextPercent: 0 },
      }),
    ).toBeNull();
  });

  it('clears all tracked state on deleteSession', () => {
    const tracker = createCircuitBreakerTracker();
    tracker.recordVerification({ sessionId: 's1', status: 'failed', limits: DEFAULT_LIMITS });
    tracker.recordVerification({ sessionId: 's1', status: 'failed', limits: DEFAULT_LIMITS });
    tracker.recordDone({ sessionId: 's1', costUsd: 6, limits: DEFAULT_LIMITS });

    tracker.deleteSession('s1');

    expect(tracker.checkCostLimit({ sessionId: 's1', limits: DEFAULT_LIMITS })).toBeNull();
    expect(
      tracker.recordVerification({ sessionId: 's1', status: 'failed', limits: DEFAULT_LIMITS }),
    ).toBeNull();
  });
});
