import { describe, expect, it } from 'vitest';
import { validateLibraryItem } from './validate.js';

const SECRET = 'hunter2-SECRET-value-98765';

function candidate(definition: unknown, kind: 'mcp' | 'connector' = 'mcp'): unknown {
  return {
    id: 'demo',
    kind,
    name: 'Demo',
    description: null,
    enabled: true,
    source: 'created',
    definition,
    updatedAt: '2026-11-17T10:00:00.000Z',
    ...(kind === 'connector' ? { label: 'Demo' } : {}),
  };
}

function errorOf(input: unknown): string {
  const checked = validateLibraryItem(input);
  if (checked.ok) throw new Error('expected the item to be rejected');
  return checked.error;
}

describe('library validation messages never echo a rejected value', () => {
  it.each([
    ['stdio env literal', candidate({ command: 'npx', env: { TOKEN: SECRET } })],
    [
      'remote header literal',
      candidate(
        { type: 'http', url: 'https://x.dev/mcp', headers: { Authorization: SECRET } },
        'connector',
      ),
    ],
    [
      'url credentials',
      candidate({ type: 'http', url: `https://user:${SECRET}@x.dev/mcp` }, 'connector'),
    ],
    [
      'url query literal',
      candidate({ type: 'http', url: `https://x.dev/mcp?token=${SECRET}` }, 'connector'),
    ],
    ['url fragment', candidate({ type: 'sse', url: `https://x.dev/mcp#${SECRET}` }, 'connector')],
    ['env value of the wrong type', candidate({ command: 'npx', env: { TOKEN: [SECRET] } })],
    ['unknown definition type', candidate({ type: SECRET, command: 'npx' })],
  ])('%s', (_name, input) => {
    expect(errorOf(input)).not.toContain(SECRET);
  });

  it('names the offending key but not its value', () => {
    const message = errorOf(candidate({ command: 'npx', env: { TOKEN: SECRET } }));
    expect(message).toContain('TOKEN');
  });
});
