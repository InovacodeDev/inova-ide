import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, test, vi } from 'vitest';
import { killProcessGroup } from '../src/main/process-group.js';

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

test('signals the whole group using the negated pid', () => {
  const send = vi.fn();
  killProcessGroup(4321, 'SIGHUP', send);
  expect(send.mock.calls).toEqual([[-4321, 'SIGHUP']]);
});

test('falls back to the pid when the group is gone or not permitted', () => {
  for (const code of ['ESRCH', 'EPERM']) {
    const send = vi.fn().mockImplementationOnce(() => {
      throw errno(code);
    });
    killProcessGroup(4321, 'SIGKILL', send);
    expect(send.mock.calls).toEqual([
      [-4321, 'SIGKILL'],
      [4321, 'SIGKILL'],
    ]);
  }
});

test('ignores ESRCH from the pid fallback because the process is already gone', () => {
  const send = vi.fn(() => {
    throw errno('ESRCH');
  });
  expect(() => killProcessGroup(4321, 'SIGHUP', send)).not.toThrow();
  expect(send).toHaveBeenCalledTimes(2);
});

test('rethrows other errors from the group and from the fallback', () => {
  const groupFails = vi.fn(() => {
    throw errno('EINVAL');
  });
  expect(() => killProcessGroup(4321, 'SIGHUP', groupFails)).toThrow('EINVAL');
  expect(groupFails).toHaveBeenCalledTimes(1);

  const pidFails = vi.fn().mockImplementation((pid: number) => {
    throw errno(pid < 0 ? 'ESRCH' : 'EPERM');
  });
  expect(() => killProcessGroup(4321, 'SIGHUP', pidFails)).toThrow('EPERM');
});

test('rejects pids that would signal the caller group or every process', () => {
  const send = vi.fn();
  for (const pid of [0, 1, -5, 1.5, Number.NaN]) {
    expect(() => killProcessGroup(pid, 'SIGKILL', send)).toThrow(RangeError);
  }
  expect(send).not.toHaveBeenCalled();
});

test('kills a real process that ignores HUP together with its children', async () => {
  const child = spawn('/bin/sh', ['-c', "trap '' HUP; sleep 30 & wait"], {
    detached: true,
    stdio: 'ignore',
  });
  const exited = once(child, 'exit');
  await new Promise((resolve) => setTimeout(resolve, 200));
  killProcessGroup(child.pid ?? 0, 'SIGHUP');
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(child.exitCode).toBeNull();
  killProcessGroup(child.pid ?? 0, 'SIGKILL');
  const [, signal] = await exited;
  expect(signal).toBe('SIGKILL');
  expect(() => killProcessGroup(child.pid ?? 0, 'SIGKILL')).not.toThrow();
});
