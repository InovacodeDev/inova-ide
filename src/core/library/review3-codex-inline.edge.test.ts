import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProfileSync, previewProfileSync } from '../profile-sync.js';
import type { LibraryItem } from './types.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-review3-inline-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const docs: LibraryItem = {
  id: 'docs',
  kind: 'mcp',
  name: 'docs',
  description: null,
  enabled: true,
  source: 'created',
  definition: { command: 'run-docs' },
  updatedAt: '2026-11-17T10:00:00.000Z',
};

const INLINE_REASON =
  'Entrada [mcp_servers] inline: edite manualmente ou remova antes de sincronizar.';

describe('an inline codex MCP entry is reported as inline', () => {
  for (const [label, toml] of [
    ['inline table', '[mcp_servers]\ndocs = { command = "INLINEMINE" }\n'],
    ['root dotted key', 'mcp_servers.docs.command = "INLINEMINE"\n'],
  ] as const) {
    it(`gives the inline reason without echoing content (${label})`, async () => {
      const root = await tmp();
      const project = await tmp();
      const home = await tmp();
      await writeFile(join(home, 'config.toml'), toml);
      const common = {
        root,
        projectPath: project,
        accounts: [{ id: 'acc', provider: 'codex' as const, label: 'c', homeDir: home }],
        library: { items: [docs], projectDisabled: [] },
      };

      const preview = await previewProfileSync(common);
      expect(preview.items[0]?.status).toBe('conflict');
      expect(preview.items[0]?.reason).toBe(INLINE_REASON);
      await applyProfileSync({ ...common, approvedIds: ['mcp:acc'] });

      expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe(toml);
    });
  }
});
