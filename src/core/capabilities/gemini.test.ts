import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CommandRunner } from '../providers.js';
import { geminiCapabilities } from './gemini.js';
import type { CapabilityContext } from './types.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/capabilities/${name}`, import.meta.url), 'utf8');
}
type RunResult = Awaited<ReturnType<CommandRunner['run']>>;
type Overrides = Partial<Record<'mcp' | 'plugin', RunResult>>;
type Call = Parameters<CommandRunner['run']>[0];

function contextWith(input: { overrides?: Overrides; calls?: Call[] }): CapabilityContext {
  const overrides = input.overrides ?? {};
  return {
    account: {
      id: 'acc-1',
      provider: 'gemini',
      label: 'Gemini',
      homeDir: '/nonexistent/acc',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    runner: {
      run: async (cmd) => {
        input.calls?.push(cmd);
        if (cmd.args[0] === 'plugin') {
          return overrides.plugin ?? { exitCode: 0, stdout: fixture('agy-plugin-list.json') };
        }
        return overrides.mcp ?? { exitCode: 0, stdout: fixture('agy-mcp-list.txt') };
      },
    },
    env: { HOME: '/nonexistent/acc' },
    projectPath: null,
    backupRoot: '/tmp/backups',
  };
}

async function categoryOf(ctx: CapabilityContext, kind: string) {
  const { categories } = await geminiCapabilities.list(ctx);
  return categories.find((entry) => entry.kind === kind);
}

describe('geminiCapabilities.list', () => {
  it('parses the mcp list table into account-file items', async () => {
    const category = await categoryOf(contextWith({}), 'mcp');
    expect(category?.error).toBeNull();
    expect(category?.items.map((item) => [item.id, item.enabled, item.applyMode])).toEqual([
      ['rea', true, 'account-file'],
      ['docs', false, 'account-file'],
    ]);
  });

  it('returns no mcp items for the empty-state message', async () => {
    const category = await categoryOf(
      contextWith({ overrides: { mcp: { exitCode: 0, stdout: 'No MCP servers configured.\n' } } }),
      'mcp',
    );
    expect(category).toEqual({ kind: 'mcp', items: [], error: null });
  });

  it('lists plugins and groups their skills as unsupported', async () => {
    const ctx = contextWith({});
    const plugins = await categoryOf(ctx, 'plugin');
    expect(plugins?.items.map((item) => [item.id, item.enabled, item.applyMode])).toEqual([
      ['dummyplug', true, 'account-file'],
      ['offplug', false, 'account-file'],
    ]);
    const skills = await categoryOf(ctx, 'skill');
    expect(
      skills?.items.map((item) => [item.id, item.enabled, item.applyMode, item.group]),
    ).toEqual([
      ['dummyplug:hello', true, 'unsupported', 'dummyplug'],
      ['dummyplug:wave', true, 'unsupported', 'dummyplug'],
      ['offplug:bye', false, 'unsupported', 'offplug'],
    ]);
    expect(skills?.items[0]?.unsupportedReason).toBe('Desligue o plugin dummyplug');
  });

  it('reports a per-category error on non-zero exit', async () => {
    const ctx = contextWith({
      overrides: { mcp: { exitCode: 1, stdout: '' }, plugin: { exitCode: 1, stdout: '' } },
    });
    expect((await categoryOf(ctx, 'mcp'))?.error).toBe(
      'Não foi possível listar os servidores MCP do agy.',
    );
    expect((await categoryOf(ctx, 'plugin'))?.error).toBe(
      'Não foi possível listar os plugins do agy.',
    );
    expect((await categoryOf(ctx, 'skill'))?.error).toBe(
      'Não foi possível listar as skills do agy.',
    );
  });

  it('reports invalid plugin JSON as an error', async () => {
    const ctx = contextWith({ overrides: { plugin: { exitCode: 0, stdout: 'oops' } } });
    expect((await categoryOf(ctx, 'plugin'))?.items).toEqual([]);
    expect((await categoryOf(ctx, 'plugin'))?.error).not.toBeNull();
  });

  it('reports a missing binary in every category', async () => {
    const ctx = contextWith({});
    const missing: CapabilityContext = {
      ...ctx,
      runner: { run: async () => ({ notFound: true }) as unknown as RunResult },
    };
    const { categories } = await geminiCapabilities.list(missing);
    expect(categories.map((entry) => entry.error)).toEqual([
      'agy não encontrado.',
      'agy não encontrado.',
      'agy não encontrado.',
    ]);
  });
});

describe('geminiCapabilities.launchArgs', () => {
  it('is empty', () => {
    expect(geminiCapabilities.launchArgs([{ kind: 'mcp', id: 'rea' }])).toEqual([]);
  });
});
