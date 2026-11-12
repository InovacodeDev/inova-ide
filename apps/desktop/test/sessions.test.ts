import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { LaunchSpec } from '@inova/core/launch';
import { clampSize, createSessionManager } from '../src/main/sessions.js';
import type { PtyProcess, SpawnPty } from '../src/main/sessions.js';

type SpawnInput = Parameters<SpawnPty>[0];

interface FakePty extends PtyProcess {
  emitData(data: string): void;
  emitExit(exitCode: number): void;
  write: PtyProcess['write'] & Mock;
  resize: PtyProcess['resize'] & Mock;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const calls: SpawnInput[] = [];
  const ptys: FakePty[] = [];
  const events = { data: vi.fn(), exit: vi.fn() };
  const killTree = vi.fn<(pid: number, signal: NodeJS.Signals) => void>();
  const spawnPty: SpawnPty = (input) => {
    calls.push(input);
    let dataCb: (data: string) => void = () => undefined;
    let exitCb: (e: { exitCode: number }) => void = () => undefined;
    const pty: FakePty = {
      pid: 1000 + ptys.length,
      onData: (cb) => {
        dataCb = cb;
      },
      onExit: (cb) => {
        exitCb = cb;
      },
      write: vi.fn(),
      resize: vi.fn(),
      emitData: (data) => dataCb(data),
      emitExit: (exitCode) => exitCb({ exitCode }),
    };
    ptys.push(pty);
    return pty;
  };
  const manager = createSessionManager({ spawnPty, events, killTree });
  return { manager, calls, ptys, events, killTree };
}

const spec: LaunchSpec = {
  command: 'claude',
  args: ['--foo'],
  cwd: '/work',
  env: { CLAUDE_CONFIG_DIR: '/home/a' },
};

function openSession(manager: ReturnType<typeof setup>['manager'], accountId = 'acc-1'): string {
  return manager.open({ spec, file: '/usr/bin/claude', accountId, cols: 100, rows: 40 });
}

test('open spawns with absolute file and spec args, cwd and env', () => {
  const { manager, calls } = setup();
  const id = openSession(manager);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(calls).toEqual([
    {
      file: '/usr/bin/claude',
      args: ['--foo'],
      cwd: '/work',
      env: { CLAUDE_CONFIG_DIR: '/home/a' },
      cols: 100,
      rows: 40,
    },
  ]);
});

test('data and exit are forwarded with the session id; exit frees the account', () => {
  const { manager, ptys, events } = setup();
  const id = openSession(manager);
  expect(manager.accountsInUse().has('acc-1')).toBe(true);

  ptys[0]?.emitData('oi');
  expect(events.data).toHaveBeenCalledWith(id, 'oi');

  ptys[0]?.emitExit(7);
  expect(events.exit).toHaveBeenCalledWith(id, 7);
  expect(manager.accountsInUse().has('acc-1')).toBe(false);
});

test('write and resize reach the process, resize is clamped', () => {
  const { manager, ptys } = setup();
  const id = openSession(manager);
  manager.write(id, 'ls');
  manager.resize({ sessionId: id, cols: 10_000, rows: 30.6 });
  expect(ptys[0]?.write).toHaveBeenCalledWith('ls');
  expect(ptys[0]?.resize).toHaveBeenCalledWith(500, 31);
});

test('close sends HUP to the process group and frees the account', () => {
  const { manager, killTree } = setup();
  const id = openSession(manager);
  manager.close(id);
  expect(killTree.mock.calls).toEqual([[1000, 'SIGHUP']]);
  expect(manager.accountsInUse().size).toBe(0);
});

test('close sends KILL to the group when no exit arrives within 2 seconds', () => {
  const { manager, killTree } = setup();
  manager.close(openSession(manager));
  vi.advanceTimersByTime(1999);
  expect(killTree).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(killTree.mock.calls).toEqual([
    [1000, 'SIGHUP'],
    [1000, 'SIGKILL'],
  ]);
});

test('an exit before 2 seconds skips KILL and clears the timer', () => {
  const { manager, ptys, killTree } = setup();
  manager.close(openSession(manager));
  expect(vi.getTimerCount()).toBe(1);
  ptys[0]?.emitExit(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(5000);
  expect(killTree.mock.calls).toEqual([[1000, 'SIGHUP']]);
});

test('closeAll closes every session and KILLs the ones that stay alive', async () => {
  const { manager, ptys, killTree } = setup();
  openSession(manager, 'acc-1');
  openSession(manager, 'acc-2');
  const done = manager.closeAll();
  expect(killTree.mock.calls).toEqual([
    [1000, 'SIGHUP'],
    [1001, 'SIGHUP'],
  ]);
  ptys[1]?.emitExit(0);
  vi.advanceTimersByTime(2000);
  await done;
  expect(killTree.mock.calls.slice(2)).toEqual([[1000, 'SIGKILL']]);
  expect(manager.accountsInUse().size).toBe(0);
});

test('closeAll resolves immediately without sessions', async () => {
  const { manager, killTree } = setup();
  await manager.closeAll();
  expect(killTree).not.toHaveBeenCalled();
});

test('closeAll also waits for sessions closed earlier that are still dying', async () => {
  const { manager, ptys } = setup();
  manager.close(openSession(manager));
  let settled = false;
  void manager.closeAll().then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(settled).toBe(false);
  ptys[0]?.emitExit(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(true);
});

test('closeAll works when detached from the manager', () => {
  const { manager, killTree } = setup();
  openSession(manager);
  const { closeAll } = manager;
  expect(() => void closeAll()).not.toThrow();
  expect(killTree).toHaveBeenCalledTimes(1);
});

test('exit after close does not throw and emits exit at most once', () => {
  const { manager, ptys, events } = setup();
  const id = openSession(manager);
  manager.close(id);
  expect(() => ptys[0]?.emitExit(0)).not.toThrow();
  expect(events.exit.mock.calls.length).toBeLessThanOrEqual(1);
});

test('close after exit does not signal the process', () => {
  const { manager, ptys, killTree } = setup();
  const id = openSession(manager);
  ptys[0]?.emitExit(0);
  manager.close(id);
  expect(killTree).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test('unknown session ids are ignored', () => {
  const { manager, calls, ptys } = setup();
  expect(() => {
    manager.write('nope', 'x');
    manager.resize({ sessionId: 'nope', cols: 80, rows: 24 });
    manager.close('nope');
  }).not.toThrow();
  expect(calls).toHaveLength(0);
  expect(ptys).toHaveLength(0);
});

test('clampSize defaults invalid axes, caps at 500 and rounds', () => {
  expect(clampSize(Number.NaN, 0)).toEqual({ cols: 80, rows: 24 });
  expect(clampSize(10_000, 30.6)).toEqual({ cols: 500, rows: 31 });
});
