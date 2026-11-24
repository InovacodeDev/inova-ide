import { describe, expect, test } from 'vitest';
import type { ChatEvent } from '@inova/core/chat-types';
import { chatReducer, initialChatState, type ChatItem } from '../src/renderer/chat-reducer.js';
import { selectOrchestratorSubsession } from '../src/renderer/orchestrator-subsession.js';
import {
  registerSubsessionCleanup,
  setupSubsessionHarness,
  unwrap,
  waitFor,
} from './orchestrator-subsession.harness.js';

registerSubsessionCleanup();

function stepItem(phase: Extract<ChatItem, { type: 'orchestrator' }>['phase']): ChatItem {
  return {
    type: 'orchestrator',
    id: `orchestrator-t1-${phase}`,
    turnId: 't1',
    phase,
    round: 1,
    maxRounds: 2,
    orchestratorLabel: 'Opus',
    developerLabel: 'Sonnet',
    verdict: null,
    summary: null,
  };
}

describe('orchestrator sub-session edge cases', () => {
  test('advance is rejected when no orchestration is active', async () => {
    const h = await setupSubsessionHarness();
    const result = await h.handlers.advanceOrchestration({ sessionId: h.session.id });
    expect(result.ok).toBe(false);
    expect(h.cancel).not.toHaveBeenCalled();
    expect((await h.handlers.advanceOrchestration({ sessionId: 42 })).ok).toBe(false);
  });

  test('advance is rejected in planning and in reviewing', async () => {
    const h = await setupSubsessionHarness();
    unwrap(await h.handlers.sendMessage({ sessionId: h.session.id, prompt: 'Faça X' }));
    expect((await h.handlers.advanceOrchestration({ sessionId: h.session.id })).ok).toBe(false);

    h.finishPhase(0, [{ kind: 'text', blockId: 'b1', text: 'Plano.' }]);
    await waitFor(() => h.send.mock.calls.length === 2);
    h.finishPhase(1, [{ kind: 'text', blockId: 'b1', text: 'Feito.' }]);
    await waitFor(() => h.send.mock.calls.length === 3);
    expect((await h.handlers.advanceOrchestration({ sessionId: h.session.id })).ok).toBe(false);
    expect(h.cancel).not.toHaveBeenCalled();
  });

  test('a double advance cancels the process once and reviews once', async () => {
    const h = await setupSubsessionHarness();
    await h.startDeveloping();
    unwrap(await h.handlers.advanceOrchestration({ sessionId: h.session.id }));
    unwrap(await h.handlers.advanceOrchestration({ sessionId: h.session.id }));
    expect(h.cancel).toHaveBeenCalledTimes(1);

    h.finishPhase(1, [], true);
    await waitFor(() => h.send.mock.calls.length === 3);
    expect(h.send).toHaveBeenCalledTimes(3);
    expect(h.doneEvents()).toHaveLength(0);
  });

  test('advance followed by cancel ends as failed, never reviewing', async () => {
    const h = await setupSubsessionHarness();
    await h.startDeveloping();
    unwrap(await h.handlers.advanceOrchestration({ sessionId: h.session.id }));
    h.handlers.cancelTurn(h.session.id);
    h.finishPhase(1, [], true);
    await h.handlers.flushPendingWrites();

    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.orchestratorEvents().at(-1)).toMatchObject({ phase: 'failed' });
    expect(h.orchestratorEvents().map((event) => event.phase)).not.toContain('reviewing');
    expect(h.doneEvents()).toEqual([expect.objectContaining({ isError: true })]);
  });

  test('cancelling twice finalizes only once', async () => {
    const h = await setupSubsessionHarness();
    await h.startDeveloping();
    h.running.delete(h.session.id);

    h.handlers.cancelTurn(h.session.id);
    h.handlers.cancelTurn(h.session.id);
    await h.handlers.flushPendingWrites();

    expect(h.doneEvents()).toHaveLength(1);
    expect(h.orchestratorEvents().filter((event) => event.phase === 'failed')).toHaveLength(1);
    expect(h.handlers.isTurnRunning(h.session.id)).toBe(false);
  });

  test('advance is rejected after the orchestration ended', async () => {
    const h = await setupSubsessionHarness();
    await h.startDeveloping();
    h.handlers.cancelTurn(h.session.id);
    h.finishPhase(1, [], true);
    expect((await h.handlers.advanceOrchestration({ sessionId: h.session.id })).ok).toBe(false);
  });

  test('selector returns null without orchestrator items', () => {
    expect(selectOrchestratorSubsession([])).toBeNull();
    const state = chatReducer(initialChatState, {
      type: 'event',
      event: { kind: 'text', blockId: 'b1', text: 'Oi' } as ChatEvent,
    });
    expect(selectOrchestratorSubsession(state.items)).toBeNull();
  });

  test('selector returns null when the orchestration completed or failed', () => {
    expect(
      selectOrchestratorSubsession([stepItem('developing'), stepItem('completed')]),
    ).toBeNull();
    expect(selectOrchestratorSubsession([stepItem('planning'), stepItem('failed')])).toBeNull();
  });

  test('selector returns an empty item list before the phase produces output and ignores other rounds', () => {
    const items: ChatItem[] = [
      stepItem('developing'),
      {
        type: 'assistant',
        id: 'orch-t1-r0-developing-b1',
        text: 'rodada antiga',
        streaming: false,
      },
    ];
    const subsession = selectOrchestratorSubsession(items);
    expect(subsession?.phase).toBe('developing');
    expect(subsession?.items).toEqual([]);
  });

  test('selector returns null once a new user turn started', () => {
    const items: ChatItem[] = [
      stepItem('developing'),
      { type: 'user', id: 'u2', text: 'novo', at: null },
    ];
    expect(selectOrchestratorSubsession(items)).toBeNull();
  });
});
