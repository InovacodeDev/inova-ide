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

