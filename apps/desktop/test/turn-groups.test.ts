import { describe, expect, test } from 'vitest';
import type { ChatItem } from '../src/renderer/chat-reducer.js';
import {
  groupChatItems,
  summarizeWork,
  toolKind,
  toolSummary,
} from '../src/renderer/turn-groups.js';

const user = (id: string): ChatItem => ({ type: 'user', id, text: 'oi' });
const text = (id: string): ChatItem => ({ type: 'assistant', id, text: 'ok', streaming: false });
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
});
