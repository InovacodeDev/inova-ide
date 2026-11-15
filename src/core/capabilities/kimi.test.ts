import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kimiCapabilities } from './kimi.js';
import type { CapabilityContext } from './types.js';

const SKILL_REASON = 'Kimi não permite desligar skills uma a uma.';
const PLUGIN_REASON = 'Kimi só desliga plugins dentro da sessão (/plugins disable).';

async function withAccountDir(
  run: (ctx: CapabilityContext) => Promise<void>,
  mcp: string | null = readFileSync(
    new URL('../fixtures/capabilities/kimi-mcp.json', import.meta.url),
    'utf8',
  ),
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'kimi-cap-'));
  try {
    if (mcp !== null) await writeFile(join(home, 'mcp.json'), mcp);
    await run({
      account: {
        id: 'acc-1',
        provider: 'kimi',
        label: 'Kimi',
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
  const { categories } = await kimiCapabilities.list(ctx);
  return categories.find((entry) => entry.kind === kind);
}

describe('kimiCapabilities.list', () => {
  it('lists mcpServers honoring enabled: false', async () => {
    await withAccountDir(async (ctx) => {
      const category = await categoryOf(ctx, 'mcp');
      expect(category?.error).toBeNull();
      expect(category?.items.map((item) => [item.id, item.enabled, item.applyMode])).toEqual([
        ['docs', true, 'account-file'],
        ['search', false, 'account-file'],
      ]);
    });
  });

  it('returns an empty mcp list when mcp.json is missing and an error when invalid', async () => {
    await withAccountDir(async (ctx) => {
      expect(await categoryOf(ctx, 'mcp')).toEqual({ kind: 'mcp', items: [], error: null });
    }, null);
    await withAccountDir(async (ctx) => {
      expect((await categoryOf(ctx, 'mcp'))?.error).toBe('O mcp.json do Kimi é inválido.');
    }, '{oops');
  });

  it('lists skills as unsupported', async () => {
    await withAccountDir(async (ctx) => {
      await mkdir(join(ctx.account.homeDir, 'skills', 'review'), { recursive: true });
      await writeFile(join(ctx.account.homeDir, 'skills', 'review', 'SKILL.md'), '# x');
      const items = (await categoryOf(ctx, 'skill'))?.items ?? [];
      expect(items.map((item) => [item.id, item.applyMode, item.unsupportedReason])).toEqual([
        ['review', 'unsupported', SKILL_REASON],
      ]);
    });
  });

  it('lists plugins from installed.json as unsupported and ignores unreadable shapes', async () => {
    await withAccountDir(async (ctx) => {
      expect((await categoryOf(ctx, 'plugin'))?.items).toEqual([]);
      await mkdir(join(ctx.account.homeDir, 'plugins'), { recursive: true });
      const file = join(ctx.account.homeDir, 'plugins', 'installed.json');
      await writeFile(file, '["alpha", {"name":"beta"}, 3]');
      const items = (await categoryOf(ctx, 'plugin'))?.items ?? [];
      expect(items.map((item) => [item.id, item.applyMode, item.unsupportedReason])).toEqual([
        ['alpha', 'unsupported', PLUGIN_REASON],
        ['beta', 'unsupported', PLUGIN_REASON],
      ]);
      await writeFile(file, '{oops');
      expect((await categoryOf(ctx, 'plugin'))?.items).toEqual([]);
    });
  });
});

describe('kimiCapabilities.setEnabled', () => {
  it('writes enabled: false and removes the key on enable, keeping other entries', async () => {
    await withAccountDir(async (ctx) => {
      const file = join(ctx.account.homeDir, 'mcp.json');
      await kimiCapabilities.setEnabled({ ctx, ref: { kind: 'mcp', id: 'docs' }, enabled: false });
      const off = JSON.parse(await readFile(file, 'utf8'));
      expect(off.mcpServers.docs).toEqual({ url: 'https://example.com/mcp', enabled: false });
      await kimiCapabilities.setEnabled({ ctx, ref: { kind: 'mcp', id: 'search' }, enabled: true });
      const on = JSON.parse(await readFile(file, 'utf8'));
      expect(on.mcpServers.search).toEqual({ command: 'search-mcp' });
    });
  });

  it('rejects skills and plugins', async () => {
    await withAccountDir(async (ctx) => {
      for (const kind of ['skill', 'plugin'] as const) {
        await expect(
          kimiCapabilities.setEnabled({ ctx, ref: { kind, id: 'x' }, enabled: false }),
        ).rejects.toThrow('Kimi não suporta desligar este item.');
      }
    });
  });

  it('has no launch args', () => {
    expect(kimiCapabilities.launchArgs([{ kind: 'mcp', id: 'docs' }])).toEqual([]);
  });
});
