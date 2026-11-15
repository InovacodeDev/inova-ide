import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { qwenCapabilities } from './qwen.js';
import type { CapabilityContext } from './types.js';

const EXTENSION_REASON =
  'O Inova ainda não consegue ler o estado das extensões do Qwen. Use qwen extensions enable/disable.';

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/capabilities/${name}`, import.meta.url), 'utf8');
}

async function withAccountDir(
  run: (ctx: CapabilityContext) => Promise<void>,
  settings: string | null = fixture('qwen-settings.json'),
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'qwen-cap-'));
  try {
    await mkdir(join(home, '.qwen'), { recursive: true });
    if (settings !== null) await writeFile(join(home, '.qwen', 'settings.json'), settings);
    await run({
      account: {
        id: 'acc-1',
        provider: 'qwen',
        label: 'Qwen',
        homeDir: home,
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
  const { categories } = await qwenCapabilities.list(ctx);
  return categories.find((entry) => entry.kind === kind);
}

describe('qwenCapabilities.list', () => {
  it('lists mcpServers as account-file items, honoring mcp.excluded', async () => {
    await withAccountDir(async (ctx) => {
      const category = await categoryOf(ctx, 'mcp');
      expect(category?.error).toBeNull();
      expect(category?.items.map((item) => [item.id, item.enabled, item.applyMode])).toEqual([
        ['docs', true, 'account-file'],
        ['search', false, 'account-file'],
      ]);
    });
  });

  it('lists user skills honoring skills.disabled', async () => {
    await withAccountDir(async (ctx) => {
      for (const name of ['review', 'plan']) {
        await mkdir(join(ctx.account.homeDir, '.qwen', 'skills', name), { recursive: true });
        await writeFile(join(ctx.account.homeDir, '.qwen', 'skills', name, 'SKILL.md'), '# x');
      }
      const skills = (await categoryOf(ctx, 'skill'))?.items ?? [];
      expect(skills.map((item) => [item.id, item.enabled, item.applyMode]).sort()).toEqual([
        ['plan', true, 'account-file'],
        ['review', false, 'account-file'],
      ]);
    });
  });

  it('lists extensions by the name in qwen-extension.json, even with invalid settings', async () => {
    await withAccountDir(async (ctx) => {
      const root = join(ctx.account.homeDir, '.qwen', 'extensions');
      await mkdir(join(root, 'dir-a'), { recursive: true });
      await writeFile(join(root, 'dir-a', 'qwen-extension.json'), '{"name":"ext-a"}');
      await mkdir(join(root, 'no-manifest'), { recursive: true });
      const category = await categoryOf(ctx, 'plugin');
      expect(category?.error).toBeNull();
      expect(
        category?.items.map((item) => [item.id, item.applyMode, item.unsupportedReason]),
      ).toEqual([['ext-a', 'unsupported', EXTENSION_REASON]]);
    }, '{ nope');
  });

  it('skips an extension with an invalid manifest and lists the others', async () => {
    await withAccountDir(async (ctx) => {
      const root = join(ctx.account.homeDir, '.qwen', 'extensions');
      await mkdir(join(root, 'bad'), { recursive: true });
      await writeFile(join(root, 'bad', 'qwen-extension.json'), '{ nope');
      await mkdir(join(root, 'good'), { recursive: true });
      await writeFile(join(root, 'good', 'qwen-extension.json'), '{"name":"ext-good"}');
      const category = await categoryOf(ctx, 'plugin');
      expect(category?.error).toBeNull();
      expect(category?.items.map((item) => item.id)).toEqual(['ext-good']);
    });
  });

  it('lists nothing without error when settings.json is missing', async () => {
    await withAccountDir(async (ctx) => {
      expect(await categoryOf(ctx, 'mcp')).toEqual({ kind: 'mcp', items: [], error: null });
    }, null);
  });

  it('reports invalid settings.json as a category error', async () => {
    await withAccountDir(async (ctx) => {
      expect((await categoryOf(ctx, 'mcp'))?.error).toBe('O settings.json do Qwen é inválido.');
      expect((await categoryOf(ctx, 'skill'))?.error).toBe('O settings.json do Qwen é inválido.');
    }, '{ nope');
  });
});

async function settingsOf(ctx: CapabilityContext): Promise<Record<string, unknown>> {
  const raw = await readFile(join(ctx.account.homeDir, '.qwen', 'settings.json'), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('qwenCapabilities.setEnabled', () => {
  it('adds and removes an MCP server in mcp.excluded, preserving other keys', async () => {
    await withAccountDir(async (ctx) => {
      await qwenCapabilities.setEnabled({ ctx, ref: { kind: 'mcp', id: 'docs' }, enabled: false });
      expect((await settingsOf(ctx))['mcp']).toEqual({ excluded: ['search', 'docs'] });
      expect(Object.keys(await settingsOf(ctx))).toContain('mcpServers');
      await qwenCapabilities.setEnabled({ ctx, ref: { kind: 'mcp', id: 'search' }, enabled: true });
      expect((await settingsOf(ctx))['mcp']).toEqual({ excluded: ['docs'] });
      expect(await readdir(ctx.backupRoot)).toHaveLength(1);
    });
  });

  it('writes skills.disabled for skills and does not duplicate names', async () => {
    await withAccountDir(async (ctx) => {
      const ref = { kind: 'skill', id: 'plan' } as const;
      await qwenCapabilities.setEnabled({ ctx, ref, enabled: false });
      await qwenCapabilities.setEnabled({ ctx, ref, enabled: false });
      expect((await settingsOf(ctx))['skills']).toEqual({ disabled: ['review', 'plan'] });
    });
  });

  it('creates settings.json when it is missing', async () => {
    await withAccountDir(async (ctx) => {
      await qwenCapabilities.setEnabled({ ctx, ref: { kind: 'mcp', id: 'docs' }, enabled: false });
      expect(await settingsOf(ctx)).toEqual({ mcp: { excluded: ['docs'] } });
    }, null);
  });

  it('[RF-1] refuses an invalid settings.json without writing', async () => {
    await withAccountDir(async (ctx) => {
      await expect(
        qwenCapabilities.setEnabled({ ctx, ref: { kind: 'mcp', id: 'docs' }, enabled: false }),
      ).rejects.toThrow('invalid JSON');
      expect(await readFile(join(ctx.account.homeDir, '.qwen', 'settings.json'), 'utf8')).toBe(
        '{ nope',
      );
      await expect(readdir(ctx.backupRoot)).rejects.toThrow();
    }, '{ nope');
  });

  it('rejects extensions with the unsupported reason and does not run qwen', async () => {
    await withAccountDir(async (ctx) => {
      let ran = false;
      const watching: CapabilityContext = {
        ...ctx,
        runner: {
          run: async () => {
            ran = true;
            return { exitCode: 0, stdout: '' };
          },
        },
      };
      await expect(
        qwenCapabilities.setEnabled({
          ctx: watching,
          ref: { kind: 'plugin', id: 'ext-a' },
          enabled: false,
        }),
      ).rejects.toThrow(EXTENSION_REASON);
      expect(ran).toBe(false);
    });
  });

  it('rejects kinds other than mcp and skill', async () => {
    await withAccountDir(async (ctx) => {
      await expect(
        qwenCapabilities.setEnabled({
          ctx,
          ref: { kind: 'connector', id: 'x' },
          enabled: false,
        }),
      ).rejects.toThrow('Qwen não suporta desligar este item.');
      expect(await readdir(ctx.backupRoot).catch(() => [])).toEqual([]);
    });
  });
});

describe('qwenCapabilities.launchArgs', () => {
  it('is always empty', () => {
    expect(qwenCapabilities.launchArgs([{ kind: 'mcp', id: 'docs' }])).toEqual([]);
  });
});
