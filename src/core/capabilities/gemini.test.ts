import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CommandRunner } from '../providers.js';
import { geminiCapabilities } from './gemini.js';
import type { CapabilityContext } from './types.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/capabilities/${name}`, import.meta.url), 'utf8');
}
type RunResult = Awaited<ReturnType<CommandRunner['run']>>;

function contextWith(result: RunResult): CapabilityContext {
  return {
    account: {
      id: 'acc-1',
      provider: 'gemini',
      label: 'Gemini',
      homeDir: '/nonexistent/acc',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    runner: { run: async () => result },
    env: { HOME: '/nonexistent/acc' },
    projectPath: null,
    backupRoot: '/tmp/backups',
  };
}

const okMcp: RunResult = { exitCode: 0, stdout: fixture('agy-mcp-list.txt') };

describe('geminiCapabilities.list', () => {
  it('parses the mcp list table into account-file items', async () => {
    const { categories } = await geminiCapabilities.list(contextWith(okMcp));
    expect(categories[0]?.error).toBeNull();
    expect(categories[0]?.items.map((item) => [item.id, item.enabled, item.applyMode])).toEqual([
      ['rea', true, 'account-file'],
      ['docs', false, 'account-file'],
    ]);
  });

  it('returns no mcp items for the empty-state message', async () => {
    const ctx = contextWith({ exitCode: 0, stdout: 'No MCP servers configured.\n' });
    const { categories } = await geminiCapabilities.list(ctx);
    expect(categories).toEqual([{ kind: 'mcp', items: [], error: null }]);
  });

  it('reports a per-category error on non-zero exit or unknown output', async () => {
    for (const result of [
      { exitCode: 1, stdout: '' },
      { exitCode: 0, stdout: 'oops\n' },
    ]) {
      const { categories } = await geminiCapabilities.list(contextWith(result));
      expect(categories[0]?.error).toBe('Não foi possível listar os servidores MCP do agy.');
    }
  });

  it('reports a missing binary', async () => {
    const { categories } = await geminiCapabilities.list(contextWith({ notFound: true }));
    expect(categories[0]?.error).toBe('agy não encontrado.');
  });
});

describe('geminiCapabilities.launchArgs', () => {
  it('is empty', () => {
    expect(geminiCapabilities.launchArgs([{ kind: 'mcp', id: 'rea' }])).toEqual([]);
  });
});
