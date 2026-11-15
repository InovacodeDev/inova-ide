import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { opencodeCapabilities } from './opencode.js';
import type { CapabilityContext } from './types.js';

async function withHome(
  run: (ctx: CapabilityContext) => Promise<void>,
  config: string | null = readFileSync(
    new URL('../fixtures/capabilities/opencode.json', import.meta.url),
    'utf8',
  ),
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'opencode-cap-'));
  try {
    if (config !== null) {
      await mkdir(join(home, '.config', 'opencode'), { recursive: true });
      await writeFile(join(home, '.config', 'opencode', 'opencode.json'), config);
    }
    await run({
      account: {
        id: 'acc-1',
        provider: 'opencode',
        label: 'OpenCode',
        homeDir: join(home, 'account'),
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      runner: { run: async () => ({ exitCode: 0, stdout: '' }) },
      env: { HOME: home },
      projectPath: null,
      backupRoot: join(home, 'backups'),
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function categoryOf(ctx: CapabilityContext, kind: string) {
  const { categories } = await opencodeCapabilities.list(ctx);
  return categories.find((entry) => entry.kind === kind);
}

function setEnabled(ctx: CapabilityContext, kind: 'mcp' | 'plugin' | 'skill', id: string) {
  return (enabled: boolean) => opencodeCapabilities.setEnabled({ ctx, ref: { kind, id }, enabled });
}

async function readConfig(ctx: CapabilityContext) {
  const file = join(ctx.env['HOME'] ?? '', '.config', 'opencode', 'opencode.json');
  return JSON.parse(await readFile(file, 'utf8'));
}

describe('opencodeCapabilities plugins', () => {
  it('merges the plugins array and the plugin folder, honoring the - prefix', async () => {
    await withHome(async (ctx) => {
      const dir = join(ctx.env['HOME'] ?? '', '.config', 'opencode', 'plugins');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'gamma.ts'), '');
      await mkdir(join(dir, 'alpha'));
      const category = await categoryOf(ctx, 'plugin');
      expect(category?.error).toBeNull();
      expect(category?.items.map((item) => [item.id, item.enabled, item.applyMode])).toEqual([
        ['alpha', true, 'global-file'],
        ['beta', false, 'global-file'],
        ['gamma', true, 'global-file'],
      ]);
    });
  });

  it('adds and removes only the -<name> entry, keeping positive entries', async () => {
    await withHome(async (ctx) => {
      await setEnabled(ctx, 'plugin', 'alpha')(false);
      expect((await readConfig(ctx)).plugins).toEqual(['alpha', '-beta', 'alpha', '-alpha']);
      await setEnabled(ctx, 'plugin', 'alpha')(true);
      await setEnabled(ctx, 'plugin', 'beta')(true);
      expect((await readConfig(ctx)).plugins).toEqual(['alpha', 'alpha']);
    });
  });
});

describe('opencodeCapabilities setEnabled', () => {
  it('writes mcp disabled: true and removes the key on enable, keeping the rest', async () => {
    await withHome(async (ctx) => {
      await setEnabled(ctx, 'mcp', 'docs')(false);
      await setEnabled(ctx, 'mcp', 'search')(true);
      const config = await readConfig(ctx);
      expect(config.mcp.docs).toEqual({
        type: 'remote',
        url: 'https://example.com/mcp',
        disabled: true,
      });
      expect(config.mcp.search).toEqual({ type: 'local', command: ['search-mcp'] });
      expect(config.theme).toBe('system');
    });
  });

  it('rejects without HOME and for unsupported kinds; launchArgs is empty', async () => {
    await withHome(async (ctx) => {
      await expect(setEnabled({ ...ctx, env: {} }, 'mcp', 'a')(false)).rejects.toThrow(
        'HOME não definido.',
      );
      const connector = { kind: 'connector', id: 'x' } as const;
      await expect(
        opencodeCapabilities.setEnabled({ ctx, ref: connector, enabled: false }),
      ).rejects.toThrow('OpenCode não suporta desligar este item.');
    });
    expect(opencodeCapabilities.launchArgs([{ kind: 'mcp', id: 'docs' }])).toEqual([]);
  });
});

describe('opencodeCapabilities mcp', () => {
  it('lists mcp servers as global-file items honoring disabled: true', async () => {
    await withHome(async (ctx) => {
      const category = await categoryOf(ctx, 'mcp');
      expect(category?.error).toBeNull();
      expect(category?.items.map((item) => [item.id, item.enabled, item.applyMode])).toEqual([
        ['docs', true, 'global-file'],
        ['search', false, 'global-file'],
      ]);
    });
  });

  it('returns empty lists without opencode.json and errors when it is invalid', async () => {
    await withHome(async (ctx) => {
      expect(await categoryOf(ctx, 'mcp')).toEqual({ kind: 'mcp', items: [], error: null });
    }, null);
    await withHome(async (ctx) => {
      expect((await categoryOf(ctx, 'mcp'))?.error).toBe('O opencode.json do OpenCode é inválido.');
    }, '{oops');
  });

  it('reports HOME não definido when HOME is missing', async () => {
    await withHome(async (ctx) => {
      const noHome = { ...ctx, env: {} };
      expect((await categoryOf(noHome, 'mcp'))?.error).toBe('HOME não definido.');
    });
  });
});
