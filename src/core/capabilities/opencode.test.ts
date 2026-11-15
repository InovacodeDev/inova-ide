import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
