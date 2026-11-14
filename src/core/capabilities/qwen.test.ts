import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { qwenCapabilities } from './qwen.js';
import type { CapabilityContext } from './types.js';

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
});

describe('qwenCapabilities.launchArgs', () => {
  it('is always empty', () => {
    expect(qwenCapabilities.launchArgs([{ kind: 'mcp', id: 'docs' }])).toEqual([]);
  });
});
