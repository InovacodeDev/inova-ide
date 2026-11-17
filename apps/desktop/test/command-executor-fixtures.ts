import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';
import type { CommandEvent } from '../src/shared/command-types.js';
import type { ChildProcessLike, SpawnChild } from '../src/main/chat.js';
import type { PtyProcess, SpawnPty } from '../src/main/sessions.js';
import { createCommandExecutor } from '../src/main/command-executor.js';
import type { CommandExecutorDeps, ExecRequest } from '../src/main/command-executor.js';

export class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  stdout = new PassThrough();
  stderr = new PassThrough();
}

export class FakePty {
  pid = 7000;
  private dataListeners: ((data: string) => void)[] = [];
  private exitListeners: ((event: { exitCode: number }) => void)[] = [];
  readonly write = vi.fn<(data: string) => void>();
  readonly resize = vi.fn<(cols: number, rows: number) => void>();
  onData(cb: (data: string) => void): void {
    this.dataListeners.push(cb);
  }
  onExit(cb: (event: { exitCode: number }) => void): void {
    this.exitListeners.push(cb);
  }
  emitData(data: string): void {
    this.dataListeners.forEach((cb) => cb(data));
  }
  emitExit(exitCode: number): void {
    this.exitListeners.forEach((cb) => cb({ exitCode }));
  }
}

export function request(overrides: Partial<ExecRequest> = {}): ExecRequest {
  return {
    commandId: 'gh.version',
    binary: 'gh',
    args: ['--version'],
    cwd: '/work',
    mutating: false,
    queueKey: 'p1',
    timeoutMs: 60_000,
    maxOutputBytes: 4096,
    ...overrides,
  };
}

export async function microtasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

export function setup(overrides: Partial<CommandExecutorDeps> = {}) {
  const children: FakeChild[] = [];
  const spawnChild = vi.fn<SpawnChild>(() => {
    const child = new FakeChild();
    child.pid = 1000 + children.length;
    children.push(child);
    return child as unknown as ChildProcessLike;
  });
  const killTree = vi.fn<(pid: number, signal: NodeJS.Signals) => void>();
  const events: CommandEvent[] = [];
  const executor = createCommandExecutor({
    spawnChild,
    killTree,
    env: async () => ({ PATH: '/bin' }),
    findBinary: async (name) => `/bin/${name}`,
    ...overrides,
  });
  executor.onEvent((event) => events.push(event));
  return { children, spawnChild, killTree, events, executor };
}

export function setupPty(overrides: Partial<CommandExecutorDeps> = {}) {
  const ptys: FakePty[] = [];
  const spawnPty = vi.fn<SpawnPty>(() => {
    const tty = new FakePty();
    ptys.push(tty);
    return tty as unknown as PtyProcess;
  });
  return { ptys, spawnPty, ...setup({ spawnPty, ...overrides }) };
}

export function outputOf(events: readonly CommandEvent[]): string {
  return events.map((event) => (event.kind === 'output' ? event.text : '')).join('');
}

export function kinds(events: readonly CommandEvent[]): string[] {
  return events.map((event) => event.kind);
}

export function exitOf(events: readonly CommandEvent[]) {
  return events.find((event) => event.kind === 'exit');
}
