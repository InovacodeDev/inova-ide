import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CommandRunner } from '../providers.js';
import { claudeCapabilities, normalizeMcpName } from './claude.js';
import type { CapabilityContext } from './types.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/capabilities/${name}`, import.meta.url), 'utf8');
}
type RunResult = Awaited<ReturnType<CommandRunner['run']>>;
type Overrides = Partial<Record<'context' | 'mcp' | 'plugin', RunResult>>;

function runnerWith(overrides: Overrides): CommandRunner {
  return {
    run: async (cmd) => {
      if (cmd.args.includes('/context')) {
        const body = JSON.stringify({ result: fixture('claude-context.md') });
        return overrides.context ?? { exitCode: 0, stdout: body };
      }
      if (cmd.args[0] === 'plugin') {
        return overrides.plugin ?? { exitCode: 0, stdout: fixture('claude-plugin-list.json') };
      }
      return overrides.mcp ?? { exitCode: 0, stdout: fixture('claude-mcp-list.txt') };
    },
  };
}

function contextWith(overrides: Overrides = {}): CapabilityContext {
  return {
    account: {
      id: 'acc-1',
      provider: 'claude',
      label: 'Claude',
      homeDir: '/home/acc',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    runner: runnerWith(overrides),
    env: {},
    projectPath: null,
    backupRoot: '/tmp/backups',
  };
}

const ctx = contextWith();

describe('claudeCapabilities.list', () => {
  it('lists connectors and MCP servers with summed tokens', async () => {
    const { categories } = await claudeCapabilities.list(ctx);
    const tokensOf = (kind: string): unknown[] =>
      (categories.find((entry) => entry.kind === kind)?.items ?? []).map((item) => [
        item.id,
        item.tokens,
      ]);
    expect(tokensOf('connector')).toEqual([
      ['claude.ai Claude Docs', 383],
      ['claude.ai Gmail', 6041],
      ['claude.ai Slack', null],
    ]);
    expect(tokensOf('mcp')).toEqual([['graft', 800]]);
  });

  it('classifies skills by source', async () => {
    const { categories } = await claudeCapabilities.list(ctx);
    const skills = categories.find((entry) => entry.kind === 'skill')?.items ?? [];
    const byId = new Map(skills.map((item) => [item.id, item]));
    expect(byId.get('dataviz')).toMatchObject({
      source: 'bundled',
      applyMode: 'launch',
      tokens: 480,
    });
    expect(byId.get('docs')).toMatchObject({ source: 'user', applyMode: 'launch', group: null });
    expect(byId.get('superpowers:brainstorming')).toMatchObject({
      source: 'plugin',
      applyMode: 'unsupported',
      unsupportedReason: 'Desligue o plugin superpowers',
      group: 'superpowers',
      description: null,
    });
  });

  it('lists plugins and honors the disabled list', async () => {
    const disabledCtx = {
      ...ctx,
      account: {
        ...ctx.account,
        disabledCapabilities: [{ kind: 'plugin', id: 'superpowers@synced' }],
      },
    } satisfies CapabilityContext;
    const pluginsOf = async (context: CapabilityContext) =>
      (await claudeCapabilities.list(context)).categories.find((entry) => entry.kind === 'plugin')
        ?.items;
    expect(await pluginsOf(ctx)).toEqual([
      {
        kind: 'plugin',
        id: 'superpowers@synced',
        name: 'superpowers@synced',
        description: null,
        source: 'plugin',
        enabled: true,
        applyMode: 'launch',
        unsupportedReason: null,
        tokens: null,
        group: null,
      },
    ]);
    expect((await pluginsOf(disabledCtx))?.[0]?.enabled).toBe(false);
  });

  it('reads the cost summary from the category table', async () => {
    const { cost } = await claudeCapabilities.list(ctx);
    expect(cost).toEqual({ loadedTokens: 612, instructionTokens: 2100, deferredTokens: 78400 });
  });

  it('reports claude not found in every category', async () => {
    const missing = { notFound: true } as const;
    const listing = await claudeCapabilities.list(contextWith({ mcp: missing }));
    expect(listing.categories.map((entry) => [entry.kind, entry.error, entry.items])).toEqual([
      ['skill', 'claude não encontrado.', []],
      ['mcp', 'claude não encontrado.', []],
      ['connector', 'claude não encontrado.', []],
      ['plugin', 'claude não encontrado.', []],
    ]);
    expect(listing.cost).toBeNull();
  });

  it('keeps connectors with null tokens when /context fails', async () => {
    const failed = { exitCode: 1, stdout: '' };
    const { categories, cost } = await claudeCapabilities.list(contextWith({ context: failed }));
    const byKind = (kind: string) => categories.find((entry) => entry.kind === kind);
    expect(byKind('skill')).toMatchObject({ items: [], error: expect.any(String) });
    expect(byKind('connector')?.error).toBeNull();
    expect(byKind('connector')?.items.map((item) => item.tokens)).toEqual([null, null, null]);
    expect(cost).toBeNull();
  });

  it('flags only the plugin category when plugin list fails', async () => {
    const failed = { exitCode: 2, stdout: '' };
    const { categories } = await claudeCapabilities.list(contextWith({ plugin: failed }));
    expect(categories.map((entry) => entry.error !== null)).toEqual([false, false, false, true]);
  });

  it('marks connectors disabled by the wildcard', async () => {
    const wildcard = contextWith();
    wildcard.account.disabledCapabilities = [{ kind: 'connector', id: '*' }];
    const { categories } = await claudeCapabilities.list(wildcard);
    const enabled = (kind: string) =>
      categories.find((entry) => entry.kind === kind)?.items.map((item) => item.enabled);
    expect(enabled('connector')).toEqual([false, false, false]);
    expect(enabled('mcp')).toEqual([true]);
  });
});

describe('normalizeMcpName', () => {
  it('replaces characters outside [A-Za-z0-9_-]', () => {
    expect(normalizeMcpName('claude.ai Gmail')).toBe('claude_ai_Gmail');
  });

  it('maps colliding names to the same value', () => {
    expect(normalizeMcpName('a.b')).toBe(normalizeMcpName('a b'));
  });
});

describe('claudeCapabilities.launchArgs', () => {
  it('returns no args when nothing is disabled', () => {
    expect(claudeCapabilities.launchArgs([])).toEqual([]);
  });

  it('builds the --settings json for each kind', () => {
    const args = claudeCapabilities.launchArgs([
      { kind: 'connector', id: 'claude.ai Gmail' },
      { kind: 'skill', id: 'dataviz' },
      { kind: 'plugin', id: 'superpowers@synced' },
    ]);
    expect(args).toHaveLength(2);
    expect(args[0]).toBe('--settings');
    expect(JSON.parse(args[1] ?? '')).toEqual({
      permissions: { deny: ['mcp__claude_ai_Gmail'] },
      skillOverrides: { dataviz: 'off' },
      enabledPlugins: { 'superpowers@synced': false },
    });
  });

  it('denies user MCP servers by normalized name', () => {
    const args = claudeCapabilities.launchArgs([{ kind: 'mcp', id: 'my.server' }]);
    expect(JSON.parse(args[1] ?? '')).toEqual({ permissions: { deny: ['mcp__my_server'] } });
  });

  it('uses disableClaudeAiConnectors for the connector wildcard', () => {
    const args = claudeCapabilities.launchArgs([
      { kind: 'connector', id: '*' },
      { kind: 'connector', id: 'claude.ai Gmail' },
      { kind: 'mcp', id: 'graft' },
    ]);
    expect(JSON.parse(args[1] ?? '')).toEqual({
      permissions: { deny: ['mcp__graft'] },
      disableClaudeAiConnectors: true,
    });
  });

  it('emits only disableClaudeAiConnectors when the wildcard is alone', () => {
    const args = claudeCapabilities.launchArgs([{ kind: 'connector', id: '*' }]);
    expect(JSON.parse(args[1] ?? '')).toEqual({ disableClaudeAiConnectors: true });
  });
});

describe('claudeCapabilities.setEnabled', () => {
  it('rejects because Claude only supports launch mode', async () => {
    await expect(
      claudeCapabilities.setEnabled({
        ctx: {} as CapabilityContext,
        ref: { kind: 'skill', id: 'dataviz' },
        enabled: false,
      }),
    ).rejects.toThrow('Claude usa só o modo launch.');
  });
});
