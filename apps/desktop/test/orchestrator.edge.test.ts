import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { addAccount } from '@inova/core/accounts';
import type { ChatEvent } from '@inova/core/chat-types';
import { bindProject } from '@inova/core/projects';
import type { CommandRunner } from '@inova/core/providers';
import { createSession, getSession } from '@inova/core/sessions';
import type { UsageDeps } from '@inova/core/usage';
import type { ChatRunner } from '../src/main/chat.js';
import { createHandlers } from '../src/main/handlers.js';
import type { SessionManager } from '../src/main/sessions.js';
import type { Result } from '../src/shared/api.js';

const execFileAsync = promisify(execFile);
const tmpDirs: string[] = [];
const createdHandlers: ReturnType<typeof createHandlers>[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-orch-desktop-edge-')));
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
      throw new Error('Timed out waiting for async orchestration edge condition');
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

async function setupEdgeHarness(options: { withGeminiBinary?: boolean } = {}) {
  const root = await tmp();
  const projectDir = await tmp();
  const bin = await tmp();
  await initGitRepo(projectDir);
  await writeFile(join(bin, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  if (options.withGeminiBinary ?? true) {
    await writeFile(join(bin, 'agy'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }

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
  const session = await createSession({ root, projectId: project.id });

  function finishPhase(callIndex: number, events: ChatEvent[], isError = false): void {
    const call = send.mock.calls[callIndex]?.[0];
    if (!call) throw new Error(`Missing call at index ${callIndex}`);
    for (const event of events) {
      handlers.handleChatEvent(call.sessionId, event);
    }
    running.delete(call.sessionId);
    chatInUse.delete(call.accountId);
    handlers.handleChatEvent(call.sessionId, {
      kind: 'done',
      isError,
      costUsd: 0.01,
      durationMs: 100,
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
    running,
    chatInUse,
    emitted,
    send,
    cancel,
    finishPhase,
  };
}

describe('orchestrator desktop edge cases', () => {
  test('skips developer and review phases on [DIRECT_GUIDANCE] without persisting Claude developer session', async () => {
    const h = await setupEdgeHarness();
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
      await h.handlers.sendMessage({ sessionId: h.session.id, prompt: 'O que faz esse repo?' }),
    );
    expect(h.send).toHaveBeenCalledTimes(1);

    h.finishPhase(0, [
      { kind: 'session', providerSessionId: 'gem-direct-1' },
      { kind: 'text', blockId: 'b1', text: 'Resumo direto.\n[DIRECT_GUIDANCE]' },
    ]);
    await h.handlers.flushPendingWrites();

    expect(h.send).toHaveBeenCalledTimes(1);
    const saved = await getSession({ root: h.root, sessionId: h.session.id });
    expect(saved.providerSessionId).toBeNull();
    expect(saved.orchestrator?.providerSessionId).toBe('gem-direct-1');
  });

  test('stops cleanly at maxRounds limit even when reviewer continues requesting changes', async () => {
    const h = await setupEdgeHarness();
    unwrap(
      await h.handlers.updateSession({
        sessionId: h.session.id,
        orchestrator: {
          enabled: true,
          accountId: h.geminiAcc.id,
          model: 'gemini-4-neon',
          maxRounds: 1,
        },
      }),
    );

    unwrap(await h.handlers.sendMessage({ sessionId: h.session.id, prompt: 'Refatore' }));
    h.finishPhase(0, [{ kind: 'text', blockId: 'b1', text: 'Plano.' }]);
    await waitFor(() => h.send.mock.calls.length === 2);

    h.finishPhase(1, [{ kind: 'text', blockId: 'b1', text: 'Feito.' }]);
    await waitFor(() => h.send.mock.calls.length === 3);

    h.finishPhase(2, [
      { kind: 'text', blockId: 'b1', text: 'Ainda ajustável.\nVERDICT: CHANGES_REQUESTED' },
    ]);
    await h.handlers.flushPendingWrites();

    expect(h.send).toHaveBeenCalledTimes(3);
    const dones = h.emitted.filter(
      (item) => item.sessionId === h.session.id && item.event.kind === 'done',
    );
    expect(dones).toHaveLength(1);
    expect(dones[0]?.event).toMatchObject({ kind: 'done', isError: false });
    const orchEvents = h.emitted
      .filter((item) => item.sessionId === h.session.id && item.event.kind === 'orchestrator')
      .map((item) => item.event as Extract<ChatEvent, { kind: 'orchestrator' }>);
    expect(orchEvents.at(-1)).toMatchObject({
      phase: 'completed',
      round: 1,
      verdict: 'changes-requested',
    });
  });

  test('cancels cleanly during planning, developing, and async git-diff transition to reviewing', async () => {
    const h = await setupEdgeHarness();
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
      await h.handlers.sendMessage({ sessionId: h.session.id, prompt: 'Teste cancelamento 1' }),
    );
    h.handlers.cancelTurn(h.session.id);
    h.finishPhase(0, [{ kind: 'error', message: 'Cancelado' }], true);
    await h.handlers.flushPendingWrites();
    expect(h.send).toHaveBeenCalledTimes(1);

    h.emitted.length = 0;
    unwrap(
      await h.handlers.sendMessage({ sessionId: h.session.id, prompt: 'Teste cancelamento 2' }),
    );
    h.finishPhase(1, [{ kind: 'text', blockId: 'b1', text: 'Plano.' }]);
    await waitFor(() => h.send.mock.calls.length === 3);

    h.finishPhase(2, [{ kind: 'text', blockId: 'b1', text: 'Editado.' }]);
    h.handlers.cancelTurn(h.session.id);

    await waitFor(() =>
      h.emitted.some((item) => item.sessionId === h.session.id && item.event.kind === 'done'),
    );
    await h.handlers.flushPendingWrites();

    expect(h.send).toHaveBeenCalledTimes(3);
    const dones = h.emitted.filter(
      (item) => item.sessionId === h.session.id && item.event.kind === 'done',
    );
    expect(dones).toHaveLength(1);
    expect(dones[0]?.event).toMatchObject({ kind: 'done', isError: true });
    const phases = h.emitted
      .filter((item) => item.sessionId === h.session.id && item.event.kind === 'orchestrator')
      .map((item) => (item.event as Extract<ChatEvent, { kind: 'orchestrator' }>).phase);
    expect(phases.at(-1)).toBe('failed');
  });

  test('validates orchestrator accounts, binaries, busy state, and failure recovery', async () => {
    const missingBinHarness = await setupEdgeHarness({ withGeminiBinary: false });
    const invalidAcc = await missingBinHarness.handlers.updateSession({
      sessionId: missingBinHarness.session.id,
      orchestrator: { enabled: true, accountId: 'nonexistent', model: 'gemini-4-neon' },
    });
    expect(invalidAcc.ok).toBe(false);

    unwrap(
      await missingBinHarness.handlers.updateSession({
        sessionId: missingBinHarness.session.id,
        orchestrator: {
          enabled: true,
          accountId: missingBinHarness.geminiAcc.id,
          model: 'gemini-4-neon',
        },
      }),
    );
    const missingBinSend = await missingBinHarness.handlers.sendMessage({
      sessionId: missingBinHarness.session.id,
      prompt: 'Rodar',
    });
    expect(missingBinSend.ok).toBe(false);

    const h = await setupEdgeHarness();
    unwrap(
      await h.handlers.updateSession({
        sessionId: h.session.id,
        orchestrator: { enabled: true, accountId: h.geminiAcc.id, model: 'gemini-4-neon' },
      }),
    );
    h.chatInUse.add(h.geminiAcc.id);
    const busyOrch = await h.handlers.sendMessage({
      sessionId: h.session.id,
      prompt: 'Rodar ocupado',
    });
    expect(busyOrch.ok).toBe(false);
    expect(busyOrch.ok ? '' : busyOrch.message).toContain('CONTA_OCUPADA');
    h.chatInUse.delete(h.geminiAcc.id);

    unwrap(await h.handlers.sendMessage({ sessionId: h.session.id, prompt: 'Rodar erro' }));
    h.finishPhase(0, [{ kind: 'error', message: 'CLI crash' }], true);
    await h.handlers.flushPendingWrites();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(
      h.emitted.some(
        (item) =>
          item.sessionId === h.session.id &&
          item.event.kind === 'orchestrator' &&
          item.event.phase === 'failed',
      ),
    ).toBe(true);
  });

  test('resets orchestrator.providerSessionId on clearSession and rewindSession while preserving config', async () => {
    const h = await setupEdgeHarness();
    unwrap(
      await h.handlers.updateSession({
        sessionId: h.session.id,
        orchestrator: {
          enabled: true,
          accountId: h.geminiAcc.id,
          model: 'gemini-4-neon',
          maxRounds: 3,
          providerSessionId: 'orch-persisted-1',
        },
      }),
    );

    unwrap(await h.handlers.sendMessage({ sessionId: h.session.id, prompt: 'Primeiro turno' }));
    h.finishPhase(0, [
      { kind: 'session', providerSessionId: 'orch-persisted-1' },
      { kind: 'text', blockId: 'b1', text: 'Ok\n[DIRECT_GUIDANCE]' },
    ]);
    await h.handlers.flushPendingWrites();

    unwrap(await h.handlers.rewindSession({ sessionId: h.session.id, turnIndex: 0 }));
    const afterRewind = await getSession({ root: h.root, sessionId: h.session.id });
    expect(afterRewind.orchestrator).toEqual({
      enabled: true,
      accountId: h.geminiAcc.id,
      model: 'gemini-4-neon',
      effort: null,
      maxRounds: 3,
      providerSessionId: null,
    });

    unwrap(
      await h.handlers.updateSession({
        sessionId: h.session.id,
        orchestrator: {
          enabled: true,
          accountId: h.geminiAcc.id,
          model: 'gemini-4-neon',
          maxRounds: 3,
          providerSessionId: 'orch-persisted-2',
        },
      }),
    );
    unwrap(await h.handlers.clearSession({ sessionId: h.session.id, keepContext: false }));
    const afterClear = await getSession({ root: h.root, sessionId: h.session.id });
    expect(afterClear.orchestrator).toEqual({
      enabled: true,
      accountId: h.geminiAcc.id,
      model: 'gemini-4-neon',
      effort: null,
      maxRounds: 3,
      providerSessionId: null,
    });
  });
});
