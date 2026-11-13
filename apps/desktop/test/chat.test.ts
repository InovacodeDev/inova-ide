import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, test, vi } from 'vitest';
import type { ChatEvent } from '@inova/core/chat-types';
import type { LaunchSpec } from '@inova/core/launch';
import { ChatBusyError, createChatRunner, parseTranscriptLine } from '../src/main/chat.js';
import type { ChildProcessLike, SpawnChild } from '../src/main/chat.js';

class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  stdout = new PassThrough();
  stderr = new PassThrough();
}

const spec: LaunchSpec = { command: 'claude', args: ['-p', 'oi'], cwd: '/work', env: { A: '1' } };
const input = (sessionId = 's1') => ({
  sessionId,
  accountId: 'acc',
  provider: 'claude' as const,
  file: '/bin/claude',
  spec,
});

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup() {
  const child = new FakeChild();
  const spawnChild = vi.fn<SpawnChild>(() => child as unknown as ChildProcessLike);
  const killTree = vi.fn<(pid: number, signal: NodeJS.Signals) => void>();
  const events: { sessionId: string; event: ChatEvent }[] = [];
  const runner = createChatRunner({
    spawnChild,
    killTree,
    emit: (sessionId, event) => events.push({ sessionId, event }),
  });
  return { child, spawnChild, killTree, events, runner };
}

const assistantLine = (text: string) =>
  JSON.stringify({
    type: 'assistant',
    message: { id: 'm1', content: [{ type: 'text', text }] },
  });
const resultLine = JSON.stringify({ type: 'result', is_error: false, total_cost_usd: 0.1 });

afterEach(() => {
  vi.useRealTimers();
});

test('spawns with the launch spec and the resolved binary', () => {
  const { spawnChild, runner } = setup();
  runner.send(input());
  expect(spawnChild).toHaveBeenCalledWith({
    file: '/bin/claude',
    args: ['-p', 'oi'],
    cwd: '/work',
    env: { A: '1' },
  });
  expect(runner.isRunning('s1')).toBe(true);
  expect(runner.accountsInUse()).toEqual(new Set(['acc']));
});

test('lines split across chunks and a trailing line without newline are parsed', async () => {
  const { child, events, runner } = setup();
  runner.send(input());
  const line = assistantLine('olá');
  child.stdout.write(line.slice(0, 10));
  await tick();
  expect(events).toEqual([]);
  child.stdout.write(`${line.slice(10)}\n${resultLine}`);
  await tick();
  child.emit('close', 0);
  const kinds = events.map(({ event }) => event.kind);
  expect(kinds).toContain('text');
  expect(kinds.filter((kind) => kind === 'done')).toHaveLength(1);
  expect(events.some(({ event }) => event.kind === 'error')).toBe(false);
  expect(runner.isRunning('s1')).toBe(false);
});

test('multi-byte characters split between chunks survive', async () => {
  const { child, events, runner } = setup();
  runner.send(input());
  const bytes = Buffer.from(`${assistantLine('çã')}\n`);
  const cut = bytes.indexOf(0xc3) + 1;
  child.stdout.write(bytes.subarray(0, cut));
  await tick();
  child.stdout.write(bytes.subarray(cut));
  await tick();
  expect(events.find(({ event }) => event.kind === 'text')?.event).toMatchObject({ text: 'çã' });
});

test('a non-zero exit without done emits error with stderr tail, then done', async () => {
  const { child, events, runner } = setup();
  runner.send(input());
  child.stderr.write('x'.repeat(5000) + 'boom\n');
  await tick();
  child.emit('close', 2);
  const [first, second] = events.map(({ event }) => event);
  expect(first?.kind).toBe('error');
  const message = first?.kind === 'error' ? first.message : '';
  expect(message.startsWith('O processo terminou com código 2: ')).toBe(true);
  expect(message.endsWith('boom')).toBe(true);
  expect(message.length).toBeLessThan(4200);
  expect(second).toEqual({ kind: 'done', isError: true, costUsd: null, durationMs: null });
});

test('a spawn error event emits error and done once', () => {
  const { child, events, runner } = setup();
  runner.send(input());
  child.emit('error', new Error('spawn claude ENOENT'));
  child.emit('close', null);
  expect(events.map(({ event }) => event.kind)).toEqual(['error', 'done']);
  expect(runner.isRunning('s1')).toBe(false);
});

test('a synchronous spawn failure emits error and done and frees the session', () => {
  const { spawnChild, events, runner } = setup();
  spawnChild.mockImplementationOnce(() => {
    throw new Error('EACCES');
  });
  runner.send(input());
  expect(events.map(({ event }) => event.kind)).toEqual(['error', 'done']);
  expect(runner.isRunning('s1')).toBe(false);
});

test('a second send for a running session is rejected', () => {
  const { spawnChild, runner } = setup();
  runner.send(input());
  expect(() => runner.send(input())).toThrow(ChatBusyError);
  expect(spawnChild).toHaveBeenCalledTimes(1);
  expect(() => runner.send(input('s2'))).not.toThrow();
});

test('cancel sends SIGTERM, then SIGKILL after 2s, and reports cancellation', () => {
  vi.useFakeTimers();
  const { child, killTree, events, runner } = setup();
  runner.send(input());
  runner.cancel('s1');
  runner.cancel('s1');
  expect(killTree).toHaveBeenCalledTimes(1);
  expect(killTree).toHaveBeenCalledWith(4242, 'SIGTERM');
  vi.advanceTimersByTime(2000);
  expect(killTree).toHaveBeenLastCalledWith(4242, 'SIGKILL');
  child.emit('close', null);
  expect(events[0]?.event).toEqual({ kind: 'error', message: 'Turno cancelado.' });
});

test('SIGKILL is not sent when the process exits within 2s', () => {
  vi.useFakeTimers();
  const { child, killTree, runner } = setup();
  runner.send(input());
  runner.cancel('s1');
  child.emit('close', 143);
  vi.advanceTimersByTime(5000);
  expect(killTree).toHaveBeenCalledTimes(1);
});

test('closeAll cancels every turn and resolves once they exit', async () => {
  const { child, killTree, runner } = setup();
  runner.send(input());
  const closed = runner.closeAll();
  expect(killTree).toHaveBeenCalledWith(4242, 'SIGTERM');
  child.emit('close', null);
  await closed;
  expect(runner.isRunning('s1')).toBe(false);
});

test('closeAll resolves after the SIGKILL fallback when the process ignores SIGTERM', async () => {
  vi.useFakeTimers();
  const { killTree, runner } = setup();
  runner.send(input());
  const closed = runner.closeAll();
  await vi.advanceTimersByTimeAsync(2000);
  await closed;
  expect(killTree).toHaveBeenLastCalledWith(4242, 'SIGKILL');
});

test('parseTranscriptLine accepts every persisted event kind and rejects malformed lines', () => {
  const events: ChatEvent[] = [
    { kind: 'session', providerSessionId: 'p' },
    { kind: 'user', text: 't', at: 'a' },
    { kind: 'text', blockId: 'b', text: 't' },
    { kind: 'tool-use', toolId: 'i', name: 'n', input: '{}' },
    { kind: 'tool-result', toolId: 'i', output: 'o', isError: true },
    { kind: 'usage-limits', windows: [{ kind: 'weekly', usedPercent: 1, resetsAt: null }] },
    { kind: 'error', message: 'm' },
    { kind: 'done', isError: false, costUsd: null, durationMs: 3 },
  ];
  for (const event of events) expect(parseTranscriptLine(JSON.stringify(event))).toEqual(event);
  for (const line of [
    '',
    'nope',
    '[]',
    '{"kind":"text"}',
    '{"kind":"done","isError":"x"}',
    '{"kind":"usage-limits","windows":[{"kind":"x"}]}',
    '{"kind":"unknown"}',
  ]) {
    expect(parseTranscriptLine(line)).toBeUndefined();
  }
});

test('a throwing killTree is logged and does not break cancel', () => {
  const { killTree, runner } = setup();
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  killTree.mockImplementation(() => {
    throw new Error('EPERM');
  });
  runner.send(input());
  expect(() => runner.cancel('s1')).not.toThrow();
  expect(log).toHaveBeenCalled();
  log.mockRestore();
  runner.send(input('s2'));
});

test('a turn is released after SIGKILL even when close never fires', () => {
  vi.useFakeTimers();
  const { child, events, runner } = setup();
  runner.send(input());
  runner.cancel('s1');
  vi.advanceTimersByTime(2000);
  expect(events.map(({ event }) => event)).toEqual([
    { kind: 'error', message: 'Turno cancelado.' },
    { kind: 'done', isError: true, costUsd: null, durationMs: null },
  ]);
  expect(runner.isRunning('s1')).toBe(false);
  expect(child.stdout.destroyed).toBe(true);
  expect(child.stderr.destroyed).toBe(true);
  child.emit('close', null);
  expect(events).toHaveLength(2);
});

test('a turn is released when the process exits but close never fires', () => {
  vi.useFakeTimers();
  const { child, events, runner } = setup();
  runner.send(input());
  child.emit('exit', 3);
  expect(runner.isRunning('s1')).toBe(true);
  vi.advanceTimersByTime(2000);
  const [first, second] = events.map(({ event }) => event);
  expect(first?.kind === 'error' && first.message).toContain('código 3');
  expect(second?.kind).toBe('done');
  expect(runner.isRunning('s1')).toBe(false);
  expect(child.stdout.destroyed).toBe(true);
  child.emit('close', 3);
  expect(events).toHaveLength(2);
});

test('close after exit finishes once and cancels the exit grace timer', () => {
  vi.useFakeTimers();
  const { child, events, runner } = setup();
  runner.send(input());
  child.emit('exit', 1);
  child.emit('close', 1);
  vi.advanceTimersByTime(5000);
  expect(events.map(({ event }) => event.kind)).toEqual(['error', 'done']);
});

test('each turn gets distinct gemini block ids', () => {
  const first = setup();
  const second = setup();
  const line = JSON.stringify({
    event: 'step_update',
    step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'x' },
  });
  for (const { runner, child } of [first, second]) {
    runner.send({ ...input(), provider: 'gemini' });
    child.stdout.write(`${line}\n`);
  }
  return tick().then(() => {
    const ids = [first, second].map(({ events }) => {
      const delta = events.find(({ event }) => event.kind === 'text-delta')?.event;
      return delta?.kind === 'text-delta' ? delta.blockId : '';
    });
    expect(ids[0]).not.toBe('');
    expect(ids[0]).not.toBe(ids[1]);
  });
});
