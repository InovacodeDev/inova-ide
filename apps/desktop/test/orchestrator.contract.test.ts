import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { addAccount } from '@inova/core/accounts';
import type { ChatEvent } from '@inova/core/chat-types';
import { bindProject } from '@inova/core/projects';
import type { CommandRunner } from '@inova/core/providers';
import { createSession, getSession } from '@inova/core/sessions';
import { loadStore } from '@inova/core/store';
import type { UsageDeps } from '@inova/core/usage';
import { parseTranscriptLine, type ChatRunner } from '../src/main/chat.js';
import { createHandlers } from '../src/main/handlers.js';
import type { SessionManager } from '../src/main/sessions.js';
import { chatReducer, initialChatState } from '../src/renderer/chat-reducer.js';
import type { Result } from '../src/shared/api.js';

const execFileAsync = promisify(execFile);
const tmpDirs: string[] = [];
const createdHandlers: ReturnType<typeof createHandlers>[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-orch-desktop-contract-')));
  tmpDirs.push(dir);
  return dir;
}

async function initGitRepo(cwd: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd });
  await execFileAsync('git', ['config', 'user.email', 'test@inova.dev'], { cwd });
  await execFileAsync('git', ['config', 'user.name', 'Inova Test'], { cwd });
  await writeFile(join(cwd, 'README.md'), 'init\n');
  await execFileAsync('git', ['add', '.'], { cwd });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd });
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for async orchestration step');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

afterEach(async () => {
  await Promise.all(createdHandlers.splice(0).map((handlers) => handlers.flushPendingWrites()));
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setupOrchestrationHarness() {
  const root = await tmp();
  const projectDir = await tmp();
  const bin = await tmp();
  await initGitRepo(projectDir);
  await writeFile(join(bin, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(join(bin, 'agy'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const running = new Set<string>();
  const chatInUse = new Set<string>();
  const emitted: { sessionId: string; event: ChatEvent }[] = [];
  const send = vi.fn<ChatRunner['send']>((input) => {
    running.add(input.sessionId);
    chatInUse.add(input.accountId);
  });
  const cancel = vi.fn<ChatRunner['cancel']>();

  const chat: ChatRunner = {
    send,
    cancel,
    isRunning: (sessionId) => running.has(sessionId),
    accountsInUse: () => chatInUse,
    closeAll: vi.fn(),
  };
  const run = vi.fn<CommandRunner['run']>(async () => ({ exitCode: 0, stdout: '{}' }));
  const fetch = vi.fn<UsageDeps['fetch']>();
  const sessions: SessionManager = {
    open: vi.fn(() => 'pty-1'),
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    closeAll: vi.fn(),
    accountsInUse: () => new Set<string>(),
  };

  const handlers = createHandlers({
    root,
    runner: { run },
    sessions,
    chat,
    usageDeps: {
      platform: 'linux',
      runner: { run },
      fetch,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    },
    emit: (sessionId, event) => emitted.push({ sessionId, event }),
    baseEnv: async () => ({ PATH: bin, TERM: 'xterm-256color' }),
    pickFolder: async () => '/picked',
    pickAttachments: async () => [],
  });
  createdHandlers.push(handlers);

  const geminiAcc = await addAccount({ root, provider: 'gemini', label: 'gem-orch' });
  const claudeAcc = await addAccount({ root, provider: 'claude', label: 'claude-dev' });
  const project = await bindProject({ root, path: projectDir, accountLabel: claudeAcc.label });
  const session = await createSession({
    root,
    projectId: project.id,
    model: 'sonnet',
    mode: 'accept-edits',
  });

  function completePhase(
    callIndex: number,
    events: ChatEvent[],
    done: { isError?: boolean; costUsd?: number | null; durationMs?: number | null } = {},
  ): void {
    const call = send.mock.calls[callIndex]?.[0];
    if (!call) throw new Error(`Missing chat.send call at index ${callIndex}`);
    for (const event of events) {
      handlers.handleChatEvent(call.sessionId, event);
    }
    running.delete(call.sessionId);
    chatInUse.delete(call.accountId);
    handlers.handleChatEvent(call.sessionId, {
      kind: 'done',
      isError: done.isError ?? false,
      costUsd: done.costUsd ?? null,
      durationMs: done.durationMs ?? null,
    });
  }

  return {
    root,
    projectDir,
    handlers,
    geminiAcc,
    claudeAcc,
    project,
    session,
    emitted,
    send,
    cancel,
    completePhase,
  };
}

describe('orchestrator desktop contract', () => {
  test('executes planning, developing, and reviewing across providers with isolated sessions and replayable transcript', async () => {
    const h = await setupOrchestrationHarness();

    const updated = unwrap(
      await h.handlers.updateSession({
        sessionId: h.session.id,
        orchestrator: {
          enabled: true,
          accountId: h.geminiAcc.id,
          model: 'gemini-4-neon',
          maxRounds: 2,
        },
      }),
    );
    expect(updated.orchestrator?.enabled).toBe(true);

    unwrap(
      await h.handlers.sendMessage({
        sessionId: h.session.id,
        prompt: 'Implemente a validação de entrada',
      }),
    );

    expect(h.send).toHaveBeenCalledTimes(1);
    const planCall = h.send.mock.calls[0]![0];
    expect(planCall.provider).toBe('gemini');
    expect(planCall.spec.args).toContain('--mode');
    expect(planCall.spec.args).toContain('plan');
    expect(planCall.spec.args).toContain('gemini-4-neon');

    h.completePhase(
      0,
      [
        { kind: 'session', providerSessionId: 'gem-orch-session-1' },
        { kind: 'text', blockId: 'b1', text: 'Plano: validar no handler.' },
        { kind: 'tool-use', toolId: 't1', name: 'Read', input: 'src/a.ts' },
        { kind: 'tool-result', toolId: 't1', output: 'ok', isError: false },
        {
          kind: 'turn-usage',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 10,
          cacheWriteTokens: 0,
        },
      ],
      { costUsd: 0.02, durationMs: 1200 },
    );

    await h.handlers.flushPendingWrites();
    const afterPlan = await getSession({ root: h.root, sessionId: h.session.id });
    expect(afterPlan.orchestrator?.providerSessionId).toBe('gem-orch-session-1');

    await waitFor(() => h.send.mock.calls.length === 2);
    const devCall = h.send.mock.calls[1]![0];
    expect(devCall.provider).toBe('claude');
    expect(devCall.spec.args).toContain('acceptEdits');
    expect(devCall.spec.args).toContain('--session-id');
    expect(devCall.spec.args.join(' ')).toContain('Plano: validar no handler.');

    h.completePhase(
      1,
      [
        { kind: 'session', providerSessionId: 'claude-dev-session-1' },
        { kind: 'text', blockId: 'b1', text: 'Implementado em src/a.ts.' },
        { kind: 'tool-use', toolId: 't1', name: 'Edit', input: 'src/a.ts' },
        { kind: 'tool-result', toolId: 't1', output: 'edited', isError: false },
        {
          kind: 'turn-usage',
          inputTokens: 200,
          outputTokens: 80,
          cacheReadTokens: 20,
          cacheWriteTokens: 5,
        },
      ],
      { costUsd: 0.05, durationMs: 2500 },
    );

    await waitFor(() => h.send.mock.calls.length === 3);
    const reviewCall = h.send.mock.calls[2]![0];
    expect(reviewCall.provider).toBe('gemini');
    expect(reviewCall.spec.args).toContain('--conversation');
    expect(reviewCall.spec.args).toContain('gem-orch-session-1');
    expect(reviewCall.spec.args.join(' ')).toContain('Implementado em src/a.ts.');

    h.completePhase(
      2,
      [
        { kind: 'text', blockId: 'b1', text: 'Código validado.\nVERDICT: APPROVED' },
        {
          kind: 'turn-usage',
          inputTokens: 90,
          outputTokens: 30,
          cacheReadTokens: 5,
          cacheWriteTokens: 0,
        },
      ],
      { costUsd: 0.01, durationMs: 800 },
    );

    await h.handlers.flushPendingWrites();

    const sessionEvents = h.emitted.filter((item) => item.sessionId === h.session.id);
    const turnUsages = sessionEvents.filter((item) => item.event.kind === 'turn-usage');
    const dones = sessionEvents.filter((item) => item.event.kind === 'done');
    expect(turnUsages).toHaveLength(1);
    expect(turnUsages[0]?.event).toEqual({
      kind: 'turn-usage',
      inputTokens: 390,
      outputTokens: 160,
      cacheReadTokens: 35,
      cacheWriteTokens: 5,
    });
    expect(dones).toHaveLength(1);
    expect(dones[0]?.event).toMatchObject({
      kind: 'done',
      isError: false,
      durationMs: 4500,
    });
    expect((dones[0]?.event as Extract<ChatEvent, { kind: 'done' }>).costUsd).toBeCloseTo(0.08);

    const assistantBlocks = sessionEvents
      .map((item) => item.event)
      .filter((event): event is Extract<ChatEvent, { kind: 'text' }> => event.kind === 'text');
    expect(new Set(assistantBlocks.map((b) => b.blockId)).size).toBe(3);

    const orchPhases = sessionEvents
      .map((item) => item.event)
      .filter(
        (event): event is Extract<ChatEvent, { kind: 'orchestrator' }> =>
          event.kind === 'orchestrator',
      );
    expect(orchPhases.map((p) => p.phase)).toEqual([
      'planning',
      'developing',
      'reviewing',
      'completed',
    ]);
    expect(orchPhases.at(-1)?.verdict).toBe('approved');

    const finalSession = await getSession({ root: h.root, sessionId: h.session.id });
    expect(finalSession.providerSessionId).not.toBe('gem-orch-session-1');
    expect(finalSession.orchestrator?.providerSessionId).toBe('gem-orch-session-1');
    expect(finalSession.usageTotals?.turns).toBe(1);
    expect(finalSession.usageTotals?.inputTokens).toBe(390);

    const rawTranscript = await readFile(join(h.root, 'sessions', `${h.session.id}.jsonl`), 'utf8');
    const parsedEvents = rawTranscript
      .split('\n')
      .flatMap((line) => parseTranscriptLine(line) ?? []);
    const replayed = chatReducer(initialChatState, { type: 'load', events: parsedEvents });
    expect(replayed.running).toBe(false);
    expect(replayed.items.filter((item) => item.type === 'orchestrator')).toHaveLength(4);
    expect(replayed.items.filter((item) => item.type === 'assistant')).toHaveLength(3);

    const store = await loadStore(h.root);
    expect(store.sessions?.[0]?.orchestrator?.enabled).toBe(true);
  });

  test('triggers round 2 developing when reviewer returns VERDICT: CHANGES_REQUESTED', async () => {
    const h = await setupOrchestrationHarness();

    unwrap(
      await h.handlers.updateSession({
        sessionId: h.session.id,
        orchestrator: {
          enabled: true,
          accountId: h.geminiAcc.id,
          model: 'gemini-4-neon',
          maxRounds: 2,
        },
      }),
    );

    unwrap(
      await h.handlers.sendMessage({
        sessionId: h.session.id,
        prompt: 'Corrija o parser',
      }),
    );

    h.completePhase(0, [
      { kind: 'session', providerSessionId: 'orch-r1' },
      { kind: 'text', blockId: 'b1', text: 'Plano inicial.' },
    ]);
    await waitFor(() => h.send.mock.calls.length === 2);

    const devInitialCall = h.send.mock.calls[1]![0];
    const devSessionIdx = devInitialCall.spec.args.indexOf('--session-id');
    const claudeDevUuid = devInitialCall.spec.args[devSessionIdx + 1]!;
    h.completePhase(1, [
      { kind: 'session', providerSessionId: claudeDevUuid },
      { kind: 'text', blockId: 'b1', text: 'Primeira entrega.' },
    ]);
    await waitFor(() => h.send.mock.calls.length === 3);

    h.completePhase(2, [
      { kind: 'text', blockId: 'b1', text: 'Faltou tratar null.\nVERDICT: CHANGES_REQUESTED' },
    ]);

    await waitFor(() => h.send.mock.calls.length === 4);
    const round2DevCall = h.send.mock.calls[3]![0];
    expect(round2DevCall.provider).toBe('claude');
    expect(round2DevCall.spec.args).toContain('--resume');
    expect(round2DevCall.spec.args).toContain(claudeDevUuid);
    expect(round2DevCall.spec.args.join(' ')).toContain('Faltou tratar null.');

    h.completePhase(3, [{ kind: 'text', blockId: 'b1', text: 'Null tratado.' }]);
    await waitFor(() => h.send.mock.calls.length === 5);

    h.completePhase(4, [{ kind: 'text', blockId: 'b1', text: 'Aprovado.\nVERDICT: APPROVED' }]);
    await h.handlers.flushPendingWrites();

    const orchEvents = h.emitted
      .filter((item) => item.sessionId === h.session.id)
      .map((item) => item.event)
      .filter(
        (event): event is Extract<ChatEvent, { kind: 'orchestrator' }> =>
          event.kind === 'orchestrator',
      );
    expect(orchEvents.map((e) => `${e.phase}@r${e.round}`)).toEqual([
      'planning@r1',
      'developing@r1',
      'reviewing@r1',
      'developing@r2',
      'reviewing@r2',
      'completed@r2',
    ]);
    expect(orchEvents[3]?.verdict).toBe('changes-requested');
    expect(orchEvents[5]?.verdict).toBe('approved');
  });
});
