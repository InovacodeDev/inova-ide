import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  it('has no launch args', () => {
    expect(grokCapabilities.launchArgs([{ kind: 'mcp', id: 'docs' }])).toEqual([]);
  });
});
