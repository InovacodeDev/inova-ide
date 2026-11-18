import { describe, expect, it } from 'vitest';
import { containsSecretLiteral, validateLibraryItem } from './validate.js';

const KEY = `sk-${'b'.repeat(30)}`;

function mcp(overrides: Record<string, unknown>): unknown {
  return {
    id: 'demo',
    kind: 'mcp',
    name: 'Demo',
    description: null,
    enabled: true,
    source: 'created',
    updatedAt: '2026-11-17T00:00:00.000Z',
    definition: { command: 'node', args: ['server.js'] },
    ...overrides,
  };
}

describe('library secret literal detection', () => {
  it('detects API-key shaped strings', () => {
    expect(containsSecretLiteral(KEY)).toBe(true);
    expect(containsSecretLiteral('sk-short')).toBe(false);
  });

  it('rejects an API key in name, description, command and args', () => {
    expect(validateLibraryItem(mcp({ name: KEY })).ok).toBe(false);
    expect(validateLibraryItem(mcp({ description: KEY })).ok).toBe(false);
    expect(validateLibraryItem(mcp({ definition: { command: KEY } })).ok).toBe(false);
    expect(validateLibraryItem(mcp({ definition: { command: 'node', args: [KEY] } })).ok).toBe(
      false,
    );
  });
});
