import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChatEvent } from './chat-types.js';
import { createChatParser } from './chat-events.js';
import type { ProviderId } from './types.js';

function parseFixture(provider: ProviderId, name: string): ChatEvent[] {
  const parser = createChatParser(provider);
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
    const parser = createChatParser('claude');
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

  it('maps weekly window', () => {
    const parser = createChatParser('claude');
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
