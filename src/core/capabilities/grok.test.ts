import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { grokCapabilities } from './grok.js';
import type { CapabilityContext } from './types.js';

async function withAccountDir(
  run: (ctx: CapabilityContext) => Promise<void>,
  config: string | null = readFileSync(
    new URL('../fixtures/capabilities/grok-config.toml', import.meta.url),
    'utf8',
  ),
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'grok-cap-'));
  try {
    if (config !== null) await writeFile(join(home, 'config.toml'), config);
    await run({
      account: {
        id: 'acc-1',
        provider: 'grok',
        label: 'Grok',
        homeDir: home,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      runner: { run: async () => ({ exitCode: 0, stdout: '' }) },
      env: {},
      projectPath: null,
      backupRoot: join(home, 'backups'),
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function categoryOf(ctx: CapabilityContext, kind: string) {
  const { categories } = await grokCapabilities.list(ctx);
  return categories.find((entry) => entry.kind === kind);
}

describe('grokCapabilities mcp', () => {
  it('lists [mcp_servers.*] honoring enabled = false', async () => {
    await withAccountDir(async (ctx) => {
      const category = await categoryOf(ctx, 'mcp');
      expect(category?.error).toBeNull();
      expect(category?.items.map((item) => [item.id, item.enabled, item.applyMode])).toEqual([
        ['docs', true, 'account-file'],
        ['search', false, 'account-file'],
      ]);
    });
  });

  it('returns empty lists when config.toml is missing and errors when it is malformed', async () => {
    await withAccountDir(async (ctx) => {
      expect(await categoryOf(ctx, 'mcp')).toEqual({ kind: 'mcp', items: [], error: null });
    }, null);
    await withAccountDir(async (ctx) => {
      expect((await categoryOf(ctx, 'mcp'))?.error).toBe('O config.toml do Grok é inválido.');
    }, '[mcp_servers.broken\nenabled = false\n');
  });

  it('lists skills and plugins from their folders honoring the disabled arrays', async () => {
    await withAccountDir(async (ctx) => {
      for (const name of ['plan', 'review']) {
        await mkdir(join(ctx.account.homeDir, 'skills', name), { recursive: true });
        await writeFile(join(ctx.account.homeDir, 'skills', name, 'SKILL.md'), '# x');
      }
      await mkdir(join(ctx.account.homeDir, 'plugins', 'tidy'), { recursive: true });
      await mkdir(join(ctx.account.homeDir, 'plugins', 'lint'), { recursive: true });
      const view = async (kind: string) =>
        ((await categoryOf(ctx, kind))?.items ?? []).map((i) => [i.id, i.enabled, i.applyMode]);
      expect((await view('skill')).sort()).toEqual([
        ['plan', false, 'account-file'],
        ['review', true, 'account-file'],
      ]);
      expect((await view('plugin')).sort()).toEqual([
        ['lint', true, 'account-file'],
        ['tidy', false, 'account-file'],
      ]);
    });
  });

  it('toggles enabled in the target table only', async () => {
    await withAccountDir(async (ctx) => {
      const file = join(ctx.account.homeDir, 'config.toml');
      await grokCapabilities.setEnabled({ ctx, ref: { kind: 'mcp', id: 'docs' }, enabled: false });
      await grokCapabilities.setEnabled({ ctx, ref: { kind: 'mcp', id: 'search' }, enabled: true });
      const toml = await readFile(file, 'utf8');
      expect(toml).toContain('[mcp_servers.docs]\nenabled = false\nurl');
      expect(toml).toContain('command = "search-mcp"\nenabled = true');
      expect(toml).toContain('[skills]\ndisabled = ["plan"]');
    });
  });

  it('edits the [skills] and [plugins] disabled arrays and rejects other kinds', async () => {
    await withAccountDir(async (ctx) => {
      const file = join(ctx.account.homeDir, 'config.toml');
      const set = (kind: 'skill' | 'plugin' | 'connector', id: string, enabled: boolean) =>
        grokCapabilities.setEnabled({ ctx, ref: { kind, id }, enabled });
      await set('skill', 'review', false);
      await set('skill', 'plan', true);
      await set('plugin', 'lint', false);
      const toml = await readFile(file, 'utf8');
      expect(toml).toContain('[skills]\ndisabled = ["review"]');
      expect(toml).toContain('[plugins]\ndisabled = ["tidy", "lint"]');
      await expect(set('connector', 'x', false)).rejects.toThrow(
        'Grok não suporta desligar este item.',
      );
    });
  });

  it('has no launch args', () => {
    expect(grokCapabilities.launchArgs([{ kind: 'mcp', id: 'docs' }])).toEqual([]);
  });
});
