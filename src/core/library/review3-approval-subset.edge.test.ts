import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProfileSync,
  previewProfileSync,
  type ProfileSyncAccountInput,
  type ProfileSyncLibraryInput,
} from '../profile-sync.js';
import type { LibraryItem } from './types.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-review3-key-')));
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

const library: ProfileSyncLibraryInput = { items: [docs], projectDisabled: [] };

async function setup(provider: 'claude' | 'codex', content: string) {
  const root = await tmp();
  const project = await tmp();
  const home = await tmp();
  const target = join(home, provider === 'claude' ? '.claude.json' : 'config.toml');
  await writeFile(target, content);
  const accounts: ProfileSyncAccountInput[] = [
    { id: 'acc', provider, label: provider, homeDir: home },
  ];
  const common = { root, projectPath: project, accounts, library };
  const preview = await previewProfileSync(common);
  expect(preview.items[0]?.status).toBe('update');
  return { common, target, key: preview.items[0]?.approvalKey ?? '' };
}

function claudeJson(input: { numStartups: number; command: string }): string {
  const { numStartups, command } = input;
  return `${JSON.stringify({ numStartups, mcpServers: { other: { command } } }, null, 2)}\n`;
}

describe('the approval key covers only the MCP subset of the target', () => {
  it('keeps the key and applies when a non-MCP field of .claude.json changes', async () => {
    const { common, target, key } = await setup(
      'claude',
      claudeJson({ numStartups: 1, command: 'o' }),
    );
    await writeFile(target, claudeJson({ numStartups: 2, command: 'o' }));
    expect((await previewProfileSync(common)).items[0]?.approvalKey).toBe(key);

    const result = await applyProfileSync({ ...common, approvals: 'key', approvedIds: [key] });

    expect(result.appliedIds).toEqual(['mcp:acc']);
    const written = JSON.parse(await readFile(target, 'utf8')) as {
      numStartups: number;
      mcpServers: Record<string, unknown>;
    };
    expect(written.numStartups).toBe(2);
    expect(Object.keys(written.mcpServers).sort()).toEqual(['docs', 'other']);
  });

  it('changes the key and skips when an MCP server of .claude.json changes', async () => {
    const { common, target, key } = await setup(
      'claude',
      claudeJson({ numStartups: 1, command: 'o' }),
    );
    const changed = claudeJson({ numStartups: 1, command: 'changed' });
    await writeFile(target, changed);
    expect((await previewProfileSync(common)).items[0]?.approvalKey).not.toBe(key);

    const result = await applyProfileSync({ ...common, approvals: 'key', approvedIds: [key] });

    expect(result.skippedIds).toEqual(['mcp:acc']);
    expect(await readFile(target, 'utf8')).toBe(changed);
  });

  it('keeps the codex key when a root key outside mcp_servers changes', async () => {
    const tables = '[mcp_servers.other]\ncommand = "o"\n';
    const { common, target, key } = await setup('codex', `model = "a"\n\n${tables}`);
    await writeFile(target, `model = "b"\n\n${tables}`);

    const result = await applyProfileSync({ ...common, approvals: 'key', approvedIds: [key] });

    expect(result.appliedIds).toEqual(['mcp:acc']);
    const toml = await readFile(target, 'utf8');
    expect(toml).toContain('model = "b"');
    expect(toml).toContain('[mcp_servers.docs]');
  });

  it('changes the codex key when an MCP table changes', async () => {
    const { common, target, key } = await setup('codex', '[mcp_servers.other]\ncommand = "o"\n');
    await writeFile(target, '[mcp_servers.other]\ncommand = "changed"\n');

    const result = await applyProfileSync({ ...common, approvals: 'key', approvedIds: [key] });

    expect(result.skippedIds).toEqual(['mcp:acc']);
  });
});
