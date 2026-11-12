import { expect, test, vi } from 'vitest';
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
  kill: PtyProcess['kill'] & Mock;
}

function setup() {
  const calls: SpawnInput[] = [];
  const ptys: FakePty[] = [];
  const events = { data: vi.fn(), exit: vi.fn() };
  const spawnPty: SpawnPty = (input) => {
    calls.push(input);
    let dataCb: (data: string) => void = () => undefined;
    let exitCb: (e: { exitCode: number }) => void = () => undefined;
    const pty: FakePty = {
      onData: (cb) => {
        dataCb = cb;
      },
      onExit: (cb) => {
        exitCb = cb;
      },
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      emitData: (data) => dataCb(data),
      emitExit: (exitCode) => exitCb({ exitCode }),
    };
    ptys.push(pty);
    return pty;
  };
  const manager = createSessionManager({ spawnPty, events });
  return { manager, calls, ptys, events };
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

test('close kills the process and frees the account', () => {
  const { manager, ptys } = setup();
  const id = openSession(manager);
  manager.close(id);
  expect(ptys[0]?.kill).toHaveBeenCalledTimes(1);
  expect(manager.accountsInUse().size).toBe(0);
});

test('closeAll kills every open session', () => {
  const { manager, ptys } = setup();
  openSession(manager, 'acc-1');
  openSession(manager, 'acc-2');
  manager.closeAll();
  expect(ptys.map((pty) => pty.kill.mock.calls.length)).toEqual([1, 1]);
  expect(manager.accountsInUse().size).toBe(0);
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
