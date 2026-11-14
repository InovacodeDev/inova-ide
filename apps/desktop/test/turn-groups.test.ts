import { describe, expect, test } from 'vitest';
import type { ChatItem } from '../src/renderer/chat-reducer.js';
import {
  activeTurnActivity,
  agentTurnFooters,
  groupChatItems,
  summarizeWork,
  toolKind,
  toolSummary,
} from '../src/renderer/turn-groups.js';

const user = (id: string): ChatItem => ({ type: 'user', id, text: 'oi', at: null });
const text = (id: string): ChatItem => ({ type: 'assistant', id, text: 'ok', streaming: false });
const think = (id: string, streaming = false): ChatItem => ({
  type: 'thinking',
  id,
  text: 'analisando',
  streaming,
});
const tool = (id: string, patch: Partial<Extract<ChatItem, { type: 'tool' }>> = {}): ChatItem => ({
  type: 'tool',
  id,
  name: 'Bash',
  input: 'ls',
  output: 'a\nb',
  isError: false,
  ...patch,
});

const shape = (items: ChatItem[], running: boolean) =>
  groupChatItems(items, running).map((block) =>
    block.kind === 'work'
      ? `work(${block.entries.map((e) => e.item.id).join(',')})`
      : block.item.id,
  );

describe('groupChatItems', () => {
  test('collapses the work of a finished turn and keeps the final answer', () => {
    const items = [user('u1'), tool('t1'), text('a1'), tool('t2'), text('a2')];
    expect(shape(items, false)).toEqual(['u1', 'work(t1,a1,t2)', 'a2']);
  });

  test('keeps every turn expanded when collapsing is turned off', () => {
    const items = [user('u1'), tool('t1'), text('a1'), tool('t2'), text('a2')];
    const blocks = groupChatItems(items, false, false);
    expect(blocks.every((block) => block.kind === 'item')).toBe(true);
    expect(blocks.map((block) => block.index)).toEqual([0, 1, 2, 3, 4]);
  });

  test('keeps the running turn expanded and collapses the earlier ones', () => {
    const items = [user('u1'), tool('t1'), text('a1'), user('u2'), tool('t2'), text('a2')];
    expect(shape(items, true)).toEqual(['u1', 'work(t1)', 'a1', 'u2', 't2', 'a2']);
  });

  test('does not collapse a turn without a final answer or without tools', () => {
    expect(shape([user('u1'), tool('t1')], false)).toEqual(['u1', 't1']);
    expect(shape([user('u1'), text('a1'), text('a2')], false)).toEqual(['u1', 'a1', 'a2']);
  });

  test('collapses thinking items with work in finished turns', () => {
    const items = [user('u1'), think('th1'), tool('t1'), text('a1')];
    expect(shape(items, false)).toEqual(['u1', 'work(th1,t1)', 'a1']);
    expect(shape([user('u1'), think('th1'), text('a1')], false)).toEqual(['u1', 'work(th1)', 'a1']);
  });

  test('keeps checkpoints, tools after the answer and their original indexes', () => {
    const checkpoint: ChatItem = {
      type: 'checkpoint',
      id: 'c1',
      turnId: 't',
      ref: 'r',
      createdAt: '',
      skippedLargeFiles: [],
    };
    const items = [user('u1'), checkpoint, tool('t1'), text('a1'), tool('t2')];
    expect(shape(items, false)).toEqual(['u1', 'c1', 'work(t1)', 'a1', 't2']);
    expect(groupChatItems(items, false).map((block) => block.index)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('toolSummary', () => {
  test('prefers the description of a JSON input and counts output lines', () => {
    const input = JSON.stringify({ command: 'pnpm test', description: 'Roda os testes' }, null, 2);
    expect(toolSummary({ input, output: 'a\nb\nc\n', isError: false })).toEqual({
      title: 'Roda os testes',
      result: '3 linhas',
    });
  });

  test('falls back to the command, the file path and the raw input', () => {
    const base = { output: '', isError: false };
    expect(toolSummary({ ...base, input: '{"command":"ls -la"}' }).title).toBe('ls -la');
    expect(toolSummary({ ...base, input: '{"file_path":"/a/b.ts"}' }).title).toBe('/a/b.ts');
    expect(toolSummary({ ...base, input: 'git status\n--short' })).toEqual({
      title: 'git status',
      result: 'sem saída',
    });
    expect(toolSummary({ ...base, input: '{broken' }).title).toBe('{broken');
  });

  test('leaves the result empty while running or on error', () => {
    expect(toolSummary({ input: 'ls', output: null, isError: false }).result).toBeNull();
    expect(toolSummary({ input: 'ls', output: 'boom', isError: true }).result).toBeNull();
  });
});

describe('summarizeWork', () => {
  test('counts commands, edits, other actions and failures', () => {
    const entries = [
      tool('t1'),
      tool('t2', { name: 'command_execution', isError: true }),
      tool('t3', { name: 'Edit' }),
      tool('t4', { name: 'Read' }),
      text('a1'),
    ].map((item, index) => ({ item, index }));
    expect(summarizeWork(entries)).toBe('2 comandos · 1 edição · 1 outra ação · 1 com erro');
  });

  test('classifies tool names', () => {
    expect([toolKind('Bash'), toolKind('write_file'), toolKind('Grep')]).toEqual([
      'shell',
      'edit',
      'other',
    ]);
  });

  test('includes diff stats and thinking in summarizeWork', () => {
    const entries = [
      think('th1'),
      tool('t1', {
        name: 'Edit',
        input: JSON.stringify({ file_path: 'src/a.ts', old_string: 'a\nb', new_string: 'a\nc\nd' }),
      }),
    ].map((item, index) => ({ item, index }));
    expect(summarizeWork(entries)).toBe('raciocínio · 1 edição (+2 -1)');
  });
});

describe('activeTurnActivity', () => {
  test('reports current pending tool or streaming thinking after the last user message', () => {
    expect(activeTurnActivity([user('u1')])).toBe('Pensando…');
    expect(activeTurnActivity([user('u1'), think('th1', true)])).toBe('Raciocinando…');
    expect(
      activeTurnActivity([
        user('u1'),
        tool('t1', {
          name: 'Edit',
          input: JSON.stringify({
            file_path: 'apps/desktop/src/App.tsx',
            old_string: 'a',
            new_string: 'b',
          }),
          output: null,
        }),
      ]),
    ).toBe('Editando App.tsx…');
    expect(
      activeTurnActivity([user('u1'), tool('t2', { name: 'Bash', input: 'ls', output: null })]),
    ).toBe('Executando comando…');
    expect(
      activeTurnActivity([
        user('u1'),
        tool('t3', {
          name: 'Read',
          input: JSON.stringify({ file_path: 'src/core/types.ts' }),
          output: null,
        }),
      ]),
    ).toBe('Consultando src/core/types.ts…');
  });
});

describe('agentTurnFooters', () => {
  const answer = (id: string, body: string, streaming = false): ChatItem => ({
    type: 'assistant',
    id,
    text: body,
    streaming,
  });
  const dated = (id: string, at: string): ChatItem => ({ type: 'user', id, text: 'oi', at });

  test('anchors on the last assistant text of each turn with the joined text and user time', () => {
    const items = [
      dated('u0', 't0'),
      answer('a', 'Primeiro'),
      tool('t'),
      answer('b', 'Segundo'),
      user('u1'),
      answer('c', 'Terceiro'),
    ];
    const footers = agentTurnFooters({ items, running: false });
    expect([...footers.keys()]).toEqual([3, 5]);
    expect(footers.get(3)).toEqual({
      turnIndex: 0,
      text: 'Primeiro\n\nSegundo',
      at: 't0',
      isLastTurn: false,
    });
    expect(footers.get(5)).toEqual({ turnIndex: 1, text: 'Terceiro', at: null, isLastTurn: true });
  });

  test('skips the running last turn and streaming blocks, and ignores items before a user turn', () => {
    const items = [
      answer('x', 'solto'),
      user('u0'),
      answer('a', 'ok'),
      user('u1'),
      answer('b', 'p'),
    ];
    expect([...agentTurnFooters({ items, running: true }).keys()]).toEqual([2]);
    const streaming = [user('u0'), answer('a', 'p', true)];
    expect(agentTurnFooters({ items: streaming, running: false }).size).toBe(0);
  });
});
