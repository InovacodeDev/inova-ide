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
  it('maps the agy fixture', () => {
    const events = parseFixture('gemini', 'agy-stream.jsonl');
    expect(events).toEqual([
      { kind: 'session', providerSessionId: '00000000-0000-4000-8000-000000000001' },
      { kind: 'text-delta', blockId: 't1:gemini-1', text: 'Here is a **short** ' },
      { kind: 'text-delta', blockId: 't1:gemini-1', text: 'answer.' },
      { kind: 'text', blockId: 't1:gemini-1', text: 'Here is a **short** answer.' },
      {
        kind: 'tool-use',
        toolId: 't1:step-2',
        name: 'run_command',
        input: JSON.stringify({ CommandLine: 'ls' }, null, 2),
      },
      {
        kind: 'tool-result',
        toolId: 't1:step-2',
        output: 'README.md',
        isError: false,
      },
      { kind: 'done', isError: false, costUsd: null, durationMs: 2500 },
    ]);
  });

  it('emits fallback response text when result arrives without streamed deltas and handles error results', () => {
    const parser = createChatParser('gemini', { turnId: 't1' });
    expect(
      parser.parse(
        JSON.stringify({
          event: 'result',
          result: { status: 'SUCCESS', response: 'hi', duration_seconds: 0.42 },
        }),
      ),
    ).toEqual([
      { kind: 'text', blockId: 't1:gemini-1', text: 'hi' },
      { kind: 'done', isError: false, costUsd: null, durationMs: 420 },
    ]);
    const failing = createChatParser('gemini', { turnId: 't2' });
    expect(
      failing.parse(
        JSON.stringify({
          event: 'result',
          result: { status: 'ERROR', error: 'bad', duration_seconds: 1.5 },
        }),
      ),
    ).toEqual([
      { kind: 'error', message: 'bad' },
      { kind: 'done', isError: true, costUsd: null, durationMs: 1500 },
    ]);
  });

  it('buffers deltas and flushes the full text when result arrives without DONE step_update', () => {
    const parser = createChatParser('gemini', { turnId: 't1' });
    const delta = (text_delta: string): string =>
      JSON.stringify({
        event: 'step_update',
        step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta },
      });
    expect(parser.parse(delta('Hel'))).toEqual([
      { kind: 'text-delta', blockId: 't1:gemini-1', text: 'Hel' },
    ]);
    expect(parser.parse(delta('lo'))).toEqual([
      { kind: 'text-delta', blockId: 't1:gemini-1', text: 'lo' },
    ]);
    expect(
      parser.parse(JSON.stringify({ event: 'result', result: { status: 'SUCCESS' } })),
    ).toEqual([
      { kind: 'text', blockId: 't1:gemini-1', text: 'Hello' },
      { kind: 'done', isError: false, costUsd: null, durationMs: null },
    ]);
  });

  it('flushes buffered text before AGY_ERROR and avoids duplicating on trailing error result', () => {
    const parser = createChatParser('gemini', { turnId: 't1' });
    parser.parse(
      JSON.stringify({
        event: 'step_update',
        step_update: {
          step_index: 1,
          state: 'ACTIVE',
          step_type: 'agent_response',
          text_delta: 'a',
        },
      }),
    );
    expect(parser.parse('AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED (code 429)"}')).toEqual([
      { kind: 'text', blockId: 't1:gemini-1', text: 'a' },
      { kind: 'error', message: 'RESOURCE_EXHAUSTED (code 429)' },
    ]);
    expect(
      parser.parse(
        JSON.stringify({ event: 'result', result: { status: 'ERROR', error: 'ignored-dup' } }),
      ),
    ).toEqual([{ kind: 'done', isError: true, costUsd: null, durationMs: null }]);
  });

  it('starts a new block after a tool call', () => {
    const parser = createChatParser('gemini', { turnId: 't1' });
    const delta = (step_index: number, text_delta: string): string =>
      JSON.stringify({
        event: 'step_update',
        step_update: { step_index, state: 'ACTIVE', step_type: 'agent_response', text_delta },
      });
    parser.parse(delta(1, 'a'));
    parser.parse(
      JSON.stringify({
        event: 'step_update',
        step_update: {
          step_index: 2,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'run_command',
        },
      }),
    );
    expect(parser.parse(delta(3, 'b'))).toEqual([
      { kind: 'text-delta', blockId: 't1:gemini-2', text: 'b' },
    ]);
  });

  it('keeps block ids distinct across turns', () => {
    const first = createChatParser('gemini', { turnId: 'a' });
    const second = createChatParser('gemini', { turnId: 'b' });
    const line = JSON.stringify({
      event: 'step_update',
      step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'x' },
    });
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
      { kind: 'context', usedTokens: 24885, windowTokens: null, model: null },
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

describe('extra providers parsers', () => {
  it('parses kimi, grok, qwen, deepseek, and opencode streams', () => {
    const kimi = createChatParser('kimi', { turnId: 't1' });
    expect(
      kimi.parse(
        JSON.stringify({
          role: 'assistant',
          content: [{ type: 'text', text: 'Oi' }],
          tool_calls: [{ id: 'c1', function: { name: 'Bash', arguments: '{"cmd":"ls"}' } }],
        }),
      ),
    ).toEqual([
      { kind: 'text', blockId: 't1:kimi-1', text: 'Oi' },
      { kind: 'tool-use', toolId: 'c1', name: 'Bash', input: '{"cmd":"ls"}' },
    ]);
    expect(kimi.parse(JSON.stringify({ role: 'tool', tool_call_id: 'c1', content: 'ok' }))).toEqual(
      [{ kind: 'tool-result', toolId: 'c1', output: 'ok', isError: false }],
    );

    const oc = createChatParser('opencode', { turnId: 't2' });
    expect(
      oc.parse(JSON.stringify({ type: 'text', sessionID: 's-oc', part: { id: 'p1', text: 'Hi' } })),
    ).toEqual([
      { kind: 'session', providerSessionId: 's-oc' },
      { kind: 'text', blockId: 'p1', text: 'Hi' },
    ]);
    expect(
      oc.parse(
        JSON.stringify({
          type: 'step_finish',
          sessionID: 's-oc',
          part: { reason: 'stop', cost: 0.02 },
        }),
      ),
    ).toEqual([{ kind: 'done', isError: false, costUsd: 0.02, durationMs: null }]);

    const ds = createChatParser('deepseek', { turnId: 't3' });
    expect(ds.parse(JSON.stringify({ type: 'thread.started', thread_id: 'th1' }))).toEqual([
      { kind: 'session', providerSessionId: 'th1' },
    ]);
    expect(
      ds.parse(
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'm1', type: 'agent_message', text: 'Pronto' },
        }),
      ),
    ).toEqual([{ kind: 'text', blockId: 't3:m1', text: 'Pronto' }]);
  });
});

describe('claude context and subagents', () => {
  const asyncToolId = 'toolu_01DU5xSQYUJnBekukKPY9Utv';
  const base = {
    kind: 'subagent',
    toolId: asyncToolId,
    description: 'Reply with ok',
    agentType: 'general-purpose',
    model: 'haiku',
  } as const;

  it('tracks an async subagent and keeps its text out of the main chat', () => {
    const events = parseFixture('claude', 'claude-subagent-async.jsonl');
    const subagents = events.filter((event) => event.kind === 'subagent');
    expect(subagents).toEqual([
      { ...base, status: 'running', inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      {
        ...base,
        model: 'claude-haiku-5-5',
        status: 'running',
        inputTokens: 15640,
        outputTokens: 4,
        totalTokens: 15644,
      },
      {
        ...base,
        model: 'claude-haiku-5-5',
        status: 'done',
        inputTokens: 15640,
        outputTokens: 4,
        totalTokens: 15644,
      },
    ]);
    const texts = events.flatMap((event) => (event.kind === 'text' ? [event.text] : []));
    expect(texts).toEqual([
      'The Haiku subagent is running in the background.',
      'The Haiku subagent finished and replied: ok.',
    ]);
  });

  it('reports main-thread context only', () => {
    const events = parseFixture('claude', 'claude-subagent-async.jsonl');
    const contexts = events.filter((event) => event.kind === 'context');
    expect(contexts).toEqual([
      { kind: 'context', usedTokens: 23190, windowTokens: 200_000, model: 'claude-haiku-5-5' },
      { kind: 'context', usedTokens: 28161, windowTokens: 200_000, model: 'claude-haiku-5-5' },
      { kind: 'context', usedTokens: 28687, windowTokens: 200_000, model: 'claude-haiku-5-5' },
    ]);
  });

  it('uses the tool_use_result totals of a synchronous subagent', () => {
    const events = parseFixture('claude', 'claude-subagent-sync.jsonl');
    const subagents = events.filter((event) => event.kind === 'subagent');
    const last = subagents[subagents.length - 1];
    expect(last).toEqual({
      kind: 'subagent',
      toolId: 'toolu_01RMZgQmvD38eyYDTmYGUPhT',
      description: 'Reply with ok',
      agentType: 'general-purpose',
      model: 'claude-haiku-5-5',
      status: 'done',
      inputTokens: 11496,
      outputTokens: 105,
      totalTokens: 11601,
    });
    expect(events.some((event) => event.kind === 'text' && event.text === 'ok')).toBe(false);
  });

  it('marks a failed subagent as error', () => {
    const parser = createChatParser('claude', { turnId: 't1' });
    parser.parse(
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'm',
          model: 'claude-opus-5-5',
          content: [{ type: 'tool_use', id: 'tu', name: 'Task', input: { description: 'd' } }],
        },
        parent_tool_use_id: null,
      }),
    );
    const events = parser.parse(
      JSON.stringify({
        type: 'system',
        subtype: 'task_notification',
        tool_use_id: 'tu',
        status: 'failed',
        usage: { total_tokens: 10 },
      }),
    );
    expect(events).toEqual([
      {
        kind: 'subagent',
        toolId: 'tu',
        description: 'd',
        agentType: null,
        model: null,
        status: 'error',
        inputTokens: 10,
        outputTokens: 0,
        totalTokens: 10,
      },
    ]);
  });

  it('emits codex context from turn.completed usage', () => {
    const events = parseFixture('codex', 'codex-exec.jsonl');
    expect(events).toContainEqual({
      kind: 'context',
      usedTokens: 24885,
      windowTokens: null,
      model: null,
    });
  });
});

describe('garbage input', () => {
  it.each(['claude', 'codex', 'gemini', 'deepseek', 'kimi', 'grok', 'qwen', 'opencode'] as const)(
    'returns [] for %s',
    (provider) => {
      const parser = createChatParser(provider, { turnId: 't1' });
      for (const line of [
        '',
        '   ',
        'not json',
        '[]',
        '42',
        'null',
        '{"type":"nope"}',
        '{"a":1}',
      ]) {
        expect(parser.parse(line)).toEqual([]);
      }
    },
  );
});
