import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, vi } from 'vitest';
import { addAccount } from '@inova/core/accounts';
import type { ChatEvent } from '@inova/core/chat-types';
import { bindProject } from '@inova/core/projects';
import type { CommandRunner } from '@inova/core/providers';
import { createSession } from '@inova/core/sessions';
import type { UsageDeps } from '@inova/core/usage';
import type { ChatRunner } from '../src/main/chat.js';
import { createHandlers } from '../src/main/handlers.js';
import type { SessionManager } from '../src/main/sessions.js';
import type { Result } from '../src/shared/api.js';

const execFileAsync = promisify(execFile);
const tmpDirs: string[] = [];
const createdHandlers: ReturnType<typeof createHandlers>[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-orch-subsession-')));
  tmpDirs.push(dir);
  return dir;
}

export function registerSubsessionCleanup(): void {
  afterEach(async () => {
    await Promise.all(createdHandlers.splice(0).map((handlers) => handlers.flushPendingWrites()));
    await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
}

export async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for orchestration condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

export type OrchestratorEvent = Extract<ChatEvent, { kind: 'orchestrator' }>;

/** Orchestrator = gemini, developer = claude. Chat processes are faked. */
export async function setupSubsessionHarness() {
  const root = await tmp();
  const projectDir = await tmp();
  const bin = await tmp();
  await execFileAsync('git', ['init'], { cwd: projectDir });
  await execFileAsync('git', ['config', 'user.email', 'test@inova.dev'], { cwd: projectDir });
  await execFileAsync('git', ['config', 'user.name', 'Inova Test'], { cwd: projectDir });
  await writeFile(join(projectDir, 'README.md'), 'init\n');
  await execFileAsync('git', ['add', '.'], { cwd: projectDir });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: projectDir });
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
      fetch: vi.fn<UsageDeps['fetch']>(),
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
  unwrap(
    await handlers.updateSession({
      sessionId: session.id,
      orchestrator: {
        enabled: true,
        accountId: geminiAcc.id,
        model: 'gemini-4-neon',
        maxRounds: 2,
      },
    }),
  );

  /** Simulates the process of call `callIndex` emitting events and exiting. */
  function finishPhase(callIndex: number, events: ChatEvent[], isError = false): void {
    const call = send.mock.calls[callIndex]?.[0];
    if (!call) throw new Error(`Missing call at index ${callIndex}`);
    for (const event of events) handlers.handleChatEvent(call.sessionId, event);
    running.delete(call.sessionId);
    chatInUse.delete(call.accountId);
    handlers.handleChatEvent(call.sessionId, {
      kind: 'done',
      isError,
      costUsd: 0.01,
      durationMs: 100,
    });
  }

  /** Sends a prompt and finishes planning; resolves once the developer process started. */
  async function startDeveloping(): Promise<void> {
    unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: 'Implemente X' }));
    finishPhase(0, [{ kind: 'text', blockId: 'b1', text: 'Plano: fazer X.' }]);
    await waitFor(() => send.mock.calls.length === 2);
  }

  function orchestratorEvents(): OrchestratorEvent[] {
    return emitted
      .filter((item) => item.sessionId === session.id && item.event.kind === 'orchestrator')
      .map((item) => item.event as OrchestratorEvent);
  }

  function doneEvents(): Extract<ChatEvent, { kind: 'done' }>[] {
    return emitted
      .filter((item) => item.sessionId === session.id && item.event.kind === 'done')
      .map((item) => item.event as Extract<ChatEvent, { kind: 'done' }>);
  }

  function errorEvents(): Extract<ChatEvent, { kind: 'error' }>[] {
    return emitted
      .filter((item) => item.sessionId === session.id && item.event.kind === 'error')
      .map((item) => item.event as Extract<ChatEvent, { kind: 'error' }>);
  }

  return {
    handlers,
    session,
    running,
    send,
    cancel,
    finishPhase,
    startDeveloping,
    orchestratorEvents,
    doneEvents,
    errorEvents,
  };
}
