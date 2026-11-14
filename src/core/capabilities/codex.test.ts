import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CommandRunner } from '../providers.js';
import { codexCapabilities } from './codex.js';
import type { CapabilityContext } from './types.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/capabilities/${name}`, import.meta.url), 'utf8');
}
type RunResult = Awaited<ReturnType<CommandRunner['run']>>;
type Overrides = Partial<Record<'mcp' | 'plugin', RunResult>>;

function runnerWith(overrides: Overrides): CommandRunner {
  return {
    run: async (cmd) => {
      if (cmd.args[0] === 'plugin') {
        return overrides.plugin ?? { exitCode: 0, stdout: fixture('codex-plugin-list.json') };
      }
      return overrides.mcp ?? { exitCode: 0, stdout: fixture('codex-mcp-list.json') };
    },
  };
}

function contextWith(input: {
  overrides?: Overrides;
  disabledCapabilities?: CapabilityContext['account']['disabledCapabilities'];
}): CapabilityContext {
  return {
    account: {
      id: 'acc-1',
      provider: 'codex',
      label: 'Codex',
      homeDir: '/nonexistent/acc',
      createdAt: '2026-01-01T00:00:00.000Z',
      disabledCapabilities: input.disabledCapabilities,
    },
    runner: runnerWith(input.overrides ?? {}),
    env: {},
    projectPath: null,
    backupRoot: '/tmp/backups',
  };
}

async function categoryOf(ctx: CapabilityContext, kind: string) {
  const { categories } = await codexCapabilities.list(ctx);
  return categories.find((entry) => entry.kind === kind);
}

describe('codexCapabilities.list', () => {
  it('lists MCP servers as launch items, honoring disabledCapabilities', async () => {
    const category = await categoryOf(
      contextWith({ disabledCapabilities: [{ kind: 'mcp', id: 'search' }] }),
      'mcp',
    );
    expect(category?.error).toBeNull();
    expect(category?.items.map((item) => [item.id, item.enabled, item.applyMode])).toEqual([
      ['docs', true, 'launch'],
      ['my.server', false, 'launch'],
      ['search', false, 'launch'],
    ]);
  });

  it('lists only installed plugins with native enabled state', async () => {
    const category = await categoryOf(
      contextWith({
        disabledCapabilities: [{ kind: 'plugin', id: 'github@openai-curated-remote' }],
      }),
      'plugin',
    );
    expect(category?.items).toEqual([
      expect.objectContaining({
        id: 'github@openai-curated-remote',
        name: 'github',
        enabled: true,
        applyMode: 'account-file',
        source: 'plugin',
      }),
      expect.objectContaining({ id: 'visualize@openai-curated-remote', enabled: false }),
    ]);
  });

  it('keeps a failing MCP command from hiding plugins', async () => {
    const ctx = contextWith({ overrides: { mcp: { exitCode: 1, stdout: '' } } });
    expect((await categoryOf(ctx, 'plugin'))?.error).toBeNull();
  });

  it('reports a failing or unparsable command in the category', async () => {
    const failed = contextWith({ overrides: { mcp: { exitCode: 1, stdout: '' } } });
    const garbage = contextWith({ overrides: { mcp: { exitCode: 0, stdout: 'not json' } } });
    const message = 'Não foi possível listar os servidores MCP do Codex.';
    expect((await categoryOf(failed, 'mcp'))?.error).toBe(message);
    expect((await categoryOf(garbage, 'mcp'))?.error).toBe(message);
  });

  it('reports not found when the binary is missing', async () => {
    const ctx = contextWith({ overrides: { mcp: { notFound: true }, plugin: { notFound: true } } });
    expect((await categoryOf(ctx, 'mcp'))?.error).toBe('codex não encontrado.');
    expect((await categoryOf(ctx, 'plugin'))?.error).toBe('codex não encontrado.');
  });
});

describe('codexCapabilities.launchArgs', () => {
  it('disables only MCP refs with -c pairs', () => {
    expect(
      codexCapabilities.launchArgs([
        { kind: 'mcp', id: 'my.server' },
        { kind: 'plugin', id: 'github@openai-curated-remote' },
        { kind: 'skill', id: 'docs' },
      ]),
    ).toEqual(['-c', 'mcp_servers."my.server".enabled=false']);
  });

  it('returns nothing when no MCP is disabled', () => {
    expect(codexCapabilities.launchArgs([])).toEqual([]);
  });
});
