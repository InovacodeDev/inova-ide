import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChatEvent } from './chat-types.js';
import { createChatParser } from './chat-events.js';
import type { ProviderId } from './types.js';

function parseFixture(provider: ProviderId, name: string): ChatEvent[] {
  const parser = createChatParser(provider, { turnId: 't1' });
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return readFileSync(url, 'utf8')
    .split('\n')
    .flatMap((line) => parser.parse(line));
}

describe('claude parser', () => {
  it('maps the streaming fixture', () => {
    const events = parseFixture('claude', 'claude-stream.jsonl');
    expect(events[0]).toEqual({
      kind: 'session',
      providerSessionId: '40b5bbda-f78a-4b16-a179-e2be215eec35',
    });
    const usage = events.find((event) => event.kind === 'usage-limits');
    expect(usage?.kind === 'usage-limits' && usage.windows[0]).toMatchObject({
      kind: 'session',
      usedPercent: 5,
      resetsAt: new Date(1794531600 * 1000).toISOString(),
    });
    const deltas = events.filter((event) => event.kind === 'text-delta');
    expect(deltas.length).toBeGreaterThan(1);
    const text = events.find((event) => event.kind === 'text');
    expect(text).toBeDefined();
    for (const delta of deltas) expect(delta.blockId).toBe('msg_01EXAMPLE');
    expect(text?.kind === 'text' && text.blockId).toBe('msg_01EXAMPLE');
    const last = events[events.length - 1];
    expect(last).toEqual({ kind: 'done', isError: false, costUsd: 0.124371, durationMs: 1919 });
    expect(events.some((event) => event.kind === 'user')).toBe(false);
  });

  it('maps tool use, results and denials', () => {
    const events = parseFixture('claude', 'claude-tool.jsonl');
    expect(events).toContainEqual({
      kind: 'tool-use',
      toolId: 'toolu_01Du8LzDv3NFZ4841ZX2n66m',
      name: 'Bash',
      input: JSON.stringify(
        { command: 'ls', description: 'List files in current directory' },
        null,
        2,
      ),
    });
    expect(events).toContainEqual({
      kind: 'tool-result',
      toolId: 'toolu_01Du8LzDv3NFZ4841ZX2n66m',
      output: 'a.err\na.jsonl\nb.err\nb.jsonl',
      isError: false,
    });
    expect(events).toContainEqual({
      kind: 'tool-result',
      toolId: 'toolu_01C1jwfLBsxMh9WnT4cSNsKp',
      output: 'This command requires approval',
      isError: true,
    });
  });

  it('joins array tool result content', () => {
    const parser = createChatParser('claude', { turnId: 't1' });
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      },
    });
    expect(parser.parse(line)).toEqual([
      { kind: 'tool-result', toolId: 't1', output: 'a\nb', isError: false },
    ]);
  });

  it('emits an error before done when the result is an error', () => {
    const parser = createChatParser('claude', { turnId: 't1' });
    const events = parser.parse(
      JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['No conversation found with session ID: x', 'second'],
      }),
    );
    expect(events).toEqual([
      { kind: 'error', message: 'No conversation found with session ID: x\nsecond' },
      { kind: 'done', isError: true, costUsd: null, durationMs: null },
    ]);
  });

  it('falls back to the result string then the subtype for error messages', () => {
    const parser = createChatParser('claude', { turnId: 't1' });
    const withResult = parser.parse(
      JSON.stringify({ type: 'result', subtype: 's', is_error: true, result: 'boom' }),
    );
    expect(withResult[0]).toEqual({ kind: 'error', message: 'boom' });
    const withSubtype = parser.parse(
      JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }),
    );
    expect(withSubtype[0]).toEqual({ kind: 'error', message: 'error_max_turns' });
  });

  it('maps weekly window', () => {
    const parser = createChatParser('claude', { turnId: 't1' });
    const line = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: {
        unifiedWindows: { seven_day: { utilization: 0.5, resetsAt: 1794531600 } },
      },
    });
    expect(parser.parse(line)).toEqual([
      {
        kind: 'usage-limits',
        windows: [
          { kind: 'weekly', usedPercent: 50, resetsAt: new Date(1794531600 * 1000).toISOString() },
        ],
      },
    ]);
  });
});

describe('gemini parser', () => {
  it('maps the fixture', () => {
    const events = parseFixture('gemini', 'gemini-stream.jsonl');
    expect(events).toEqual([
      { kind: 'session', providerSessionId: '00000000-0000-4000-8000-000000000001' },
      { kind: 'text-delta', blockId: 't1:gemini-1', text: 'Here is a **short** ' },
      { kind: 'text', blockId: 't1:gemini-1', text: 'Here is a **short** ' },
      {
        kind: 'tool-use',
        toolId: 't1:run_shell_command-1',
        name: 'run_shell_command',
        input: JSON.stringify({ command: 'ls' }, null, 2),
      },
      {
        kind: 'tool-result',
        toolId: 't1:run_shell_command-1',
        output: 'README.md',
        isError: false,
      },
      { kind: 'error', message: 'example warning' },
      { kind: 'done', isError: false, costUsd: null, durationMs: null },
    ]);
  });

  it('emits text for non-delta assistant messages and failures for error results', () => {
    const parser = createChatParser('gemini', { turnId: 't1' });
    expect(
      parser.parse(JSON.stringify({ type: 'message', role: 'assistant', content: 'hi' })),
    ).toEqual([{ kind: 'text', blockId: 't1:gemini-1', text: 'hi' }]);
    expect(
      parser.parse(JSON.stringify({ type: 'result', status: 'error', error: { message: 'bad' } })),
    ).toEqual([
      { kind: 'error', message: 'bad' },
      { kind: 'done', isError: true, costUsd: null, durationMs: null },
    ]);
  });

  it('buffers deltas and emits the full text when the block ends', () => {
    const parser = createChatParser('gemini', { turnId: 't1' });
    const delta = (content: string): string =>
      JSON.stringify({ type: 'message', role: 'assistant', content, delta: true });
    expect(parser.parse(delta('Hel'))).toEqual([
      { kind: 'text-delta', blockId: 't1:gemini-1', text: 'Hel' },
    ]);
    expect(parser.parse(delta('lo'))).toEqual([
      { kind: 'text-delta', blockId: 't1:gemini-1', text: 'lo' },
    ]);
    const result = parser.parse(JSON.stringify({ type: 'result', status: 'success', stats: {} }));
    expect(result).toEqual([
      { kind: 'text', blockId: 't1:gemini-1', text: 'Hello' },
      { kind: 'done', isError: false, costUsd: null, durationMs: null },
    ]);
  });

  it('flushes buffered text before a following error', () => {
    const parser = createChatParser('gemini', { turnId: 't1' });
    parser.parse(JSON.stringify({ type: 'message', role: 'assistant', content: 'a', delta: true }));
    expect(parser.parse(JSON.stringify({ type: 'error', message: 'x' }))).toEqual([
      { kind: 'text', blockId: 't1:gemini-1', text: 'a' },
      { kind: 'error', message: 'x' },
    ]);
  });

  it('starts a new block after a tool call', () => {
    const parser = createChatParser('gemini', { turnId: 't1' });
    const delta = (content: string): string =>
      JSON.stringify({ type: 'message', role: 'assistant', content, delta: true });
    parser.parse(delta('a'));
    parser.parse(JSON.stringify({ type: 'tool_use', tool_id: 'x', tool_name: 'n' }));
    expect(parser.parse(delta('b'))).toEqual([
      { kind: 'text-delta', blockId: 't1:gemini-3', text: 'b' },
    ]);
  });

  it('keeps block ids distinct across turns', () => {
    const first = createChatParser('gemini', { turnId: 'a' });
    const second = createChatParser('gemini', { turnId: 'b' });
    const line = JSON.stringify({ type: 'message', role: 'assistant', content: 'x' });
    expect(first.parse(line)).not.toEqual(second.parse(line));
  });
});

describe('codex parser', () => {
  it('maps the fixture', () => {
    const events = parseFixture('codex', 'codex-exec.jsonl');
    expect(events).toEqual([
      { kind: 'session', providerSessionId: '0199a213-81c0-7800-8aa1-bbab2a035a53' },
      { kind: 'tool-use', toolId: 't1:item_1', name: 'command_execution', input: 'bash -lc ls' },
      { kind: 'tool-result', toolId: 't1:item_1', output: 'README.md\nsrc\n', isError: false },
      expect.objectContaining({ kind: 'text', blockId: 't1:item_2' }),
      { kind: 'done', isError: false, costUsd: null, durationMs: null },
      { kind: 'error', message: 'stream disconnected before completion' },
      { kind: 'done', isError: true, costUsd: null, durationMs: null },
      { kind: 'error', message: 'stream disconnected before completion' },
    ]);
  });

  it('flags non-zero exit codes', () => {
    const parser = createChatParser('codex', { turnId: 't1' });
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'i', type: 'command_execution', aggregated_output: 'x', exit_code: 2 },
    });
    expect(parser.parse(line)).toEqual([
      { kind: 'tool-result', toolId: 't1:i', output: 'x', isError: true },
    ]);
  });

  it('keeps item ids distinct across turns', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'hi' },
    });
    const first = createChatParser('codex', { turnId: 'a' }).parse(line);
    const second = createChatParser('codex', { turnId: 'b' }).parse(line);
    expect(first).not.toEqual(second);
  });
});

describe('garbage input', () => {
  it.each(['claude', 'codex', 'gemini'] as const)('returns [] for %s', (provider) => {
    const parser = createChatParser(provider, { turnId: 't1' });
    for (const line of ['', '   ', 'not json', '[]', '42', 'null', '{"type":"nope"}', '{"a":1}']) {
      expect(parser.parse(line)).toEqual([]);
    }
  });
});
