import { describe, expect, test } from 'vitest';
import type { ChatEvent } from '@inova/core/chat-types';
import { chatReducer, initialChatState, type ChatState } from '../src/renderer/chat-reducer.js';
import { selectOrchestratorSubsession } from '../src/renderer/orchestrator-subsession.js';
import {
  registerSubsessionCleanup,
  setupSubsessionHarness,
  unwrap,
  waitFor,
} from './orchestrator-subsession.harness.js';

registerSubsessionCleanup();

function orchestratorEvent(
  phase: Extract<ChatEvent, { kind: 'orchestrator' }>['phase'],
  round = 1,
): ChatEvent {
  return {
    kind: 'orchestrator',
    turnId: 't1',
    phase,
    round,
    maxRounds: 2,
    orchestratorLabel: 'Opus',
    developerLabel: 'Sonnet',
  };
}

function reduce(events: ChatEvent[]): ChatState {
  return events.reduce(
    (state, event) => chatReducer(state, { type: 'event', event }),
    initialChatState,
  );
}

describe('orchestrator sub-session contract', () => {
  test('advancing during developing goes to reviewing (not failed) with the partial report', async () => {
    const h = await setupSubsessionHarness();
    await h.startDeveloping();
    h.handlers.handleChatEvent(h.session.id, {
      kind: 'text',
      blockId: 'b1',
      text: 'Metade feita em src/a.ts.',
    });

    unwrap(await h.handlers.advanceOrchestration({ sessionId: h.session.id }));
    expect(h.cancel).toHaveBeenCalledWith(h.session.id);

    // The runner reports the killed process as an error + failed done.
    h.finishPhase(1, [{ kind: 'error', message: 'Turno cancelado.' }], true);
    await waitFor(() => h.send.mock.calls.length === 3);

    const reviewCall = h.send.mock.calls[2]![0];
    expect(reviewCall.provider).toBe('gemini');
    const reviewPrompt = reviewCall.spec.args.join(' ');
    expect(reviewPrompt).toContain('Metade feita em src/a.ts.');
    expect(reviewPrompt).toContain('encerrou a fase do desenvolvedor antecipadamente');

    const phases = h.orchestratorEvents().map((event) => event.phase);
    expect(phases.slice(-2)).toEqual(['developing', 'reviewing']);
    expect(phases).not.toContain('failed');
    expect(h.doneEvents()).toHaveLength(0);
    expect(h.errorEvents()).toHaveLength(0);

    h.finishPhase(2, [{ kind: 'text', blockId: 'b1', text: 'Ok.\nVERDICT: APPROVED' }]);
    await h.handlers.flushPendingWrites();
    expect(h.orchestratorEvents().at(-1)).toMatchObject({
      phase: 'completed',
      verdict: 'approved',
    });
    expect(h.doneEvents()).toEqual([expect.objectContaining({ isError: false })]);
  });

  test('cancelling during developing ends with failed and a single done', async () => {
    const h = await setupSubsessionHarness();
    await h.startDeveloping();

    h.handlers.cancelTurn(h.session.id);
    h.finishPhase(1, [{ kind: 'error', message: 'Turno cancelado.' }], true);
    await h.handlers.flushPendingWrites();

    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.orchestratorEvents().at(-1)).toMatchObject({ phase: 'failed' });
    expect(h.doneEvents()).toEqual([expect.objectContaining({ isError: true })]);
    expect(h.handlers.isTurnRunning(h.session.id)).toBe(false);
  });

  test('cancelling while no process runs finalizes immediately', async () => {
    const h = await setupSubsessionHarness();
    await h.startDeveloping();
    h.running.delete(h.session.id);
    expect(h.handlers.isTurnRunning(h.session.id)).toBe(true);

    h.handlers.cancelTurn(h.session.id);

    expect(h.orchestratorEvents().at(-1)).toMatchObject({ phase: 'failed' });
    expect(h.doneEvents()).toEqual([expect.objectContaining({ isError: true })]);
    expect(h.handlers.isTurnRunning(h.session.id)).toBe(false);
  });

  test('isTurnRunning reflects the busy state of the session', async () => {
    const h = await setupSubsessionHarness();
    expect(h.handlers.isTurnRunning(h.session.id)).toBe(false);
    await h.startDeveloping();
    expect(h.handlers.isTurnRunning(h.session.id)).toBe(true);
    h.finishPhase(1, [{ kind: 'text', blockId: 'b1', text: 'Feito.' }]);
    await waitFor(() => h.send.mock.calls.length === 3);
    expect(h.handlers.isTurnRunning(h.session.id)).toBe(true);
    h.finishPhase(2, [{ kind: 'text', blockId: 'b1', text: 'VERDICT: APPROVED' }]);
    expect(h.handlers.isTurnRunning(h.session.id)).toBe(false);
  });

  test('selector returns only the items of the current phase', () => {
    const state = reduce([
      { kind: 'user', text: 'Faça X', at: null },
      orchestratorEvent('planning'),
      { kind: 'text', blockId: 'orch-t1-r1-planning-b1', text: 'Plano.' },
      orchestratorEvent('developing'),
      { kind: 'text', blockId: 'orch-t1-r1-developing-b1', text: 'Implementando.' },
      { kind: 'thinking', blockId: 'orch-t1-r1-developing-th1', text: 'Pensando.' },
      { kind: 'tool-use', toolId: 'orch-t1-r1-developing-tool1', name: 'Edit', input: 'a.ts' },
    ] as ChatEvent[]);

    const subsession = selectOrchestratorSubsession(state.items);
    expect(subsession).toMatchObject({
      phase: 'developing',
      round: 1,
      maxRounds: 2,
      agentLabel: 'Sonnet',
    });
    expect(subsession?.items.map((item) => item.id)).toEqual([
      'orch-t1-r1-developing-b1',
      'thinking-orch-t1-r1-developing-th1',
      'orch-t1-r1-developing-tool1',
    ]);
  });
});
