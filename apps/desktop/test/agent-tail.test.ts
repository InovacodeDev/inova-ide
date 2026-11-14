import { describe, expect, test } from 'vitest';
import type { ChatItem } from '../src/renderer/chat-reducer';
import { agentTail } from '../src/renderer/agent-tail';

const tool = (output: string | null): ChatItem => ({
  type: 'tool',
  id: 't',
  name: 'Bash',
  input: 'ls -la',
  output,
  isError: false,
});

describe('agentTail', () => {
  test('returns empty string without items', () => {
    expect(agentTail({ items: [], lines: 3 })).toBe('');
  });

  test('uses assistant text', () => {
    const items: ChatItem[] = [{ type: 'assistant', id: 'a', text: 'a\n\nb\nc', streaming: true }];
    expect(agentTail({ items, lines: 2 })).toBe('b\nc');
  });

  test('uses user text', () => {
    const items: ChatItem[] = [{ type: 'user', id: 'u', text: 'oi', at: null }];
    expect(agentTail({ items, lines: 3 })).toBe('oi');
  });

  test('uses error message', () => {
    const items: ChatItem[] = [{ type: 'error', id: 'e', message: 'falhou' }];
    expect(agentTail({ items, lines: 3 })).toBe('falhou');
  });

  test('prefixes tool name and prefers output over input', () => {
    expect(agentTail({ items: [tool('done')], lines: 5 })).toBe('› Bash\ndone');
  });

  test('falls back to tool input when output is null', () => {
    expect(agentTail({ items: [tool(null)], lines: 5 })).toBe('› Bash\nls -la');
  });

  test('only looks at the last item', () => {
    const items: ChatItem[] = [{ type: 'user', id: 'u', text: 'antigo', at: null }, tool('x')];
    expect(agentTail({ items, lines: 1 })).toBe('x');
  });
});
