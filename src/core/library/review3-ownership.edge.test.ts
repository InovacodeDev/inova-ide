import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProfileSync,
  previewProfileSync,
  type ProfileSyncAccountInput,
  type ProfileSyncLibraryInput,
} from '../profile-sync.js';
import { loadManaged } from './managed.js';
import type { LibraryItem } from './types.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-review3-owner-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function mcpItem(id: string, args?: string[]): LibraryItem {
  return {
    id,
    kind: 'mcp',
    name: id,
    description: null,
    enabled: true,
    source: 'created',
    definition: { command: `run-${id}`, ...(args ? { args } : {}) },
    updatedAt: '2026-11-17T10:00:00.000Z',
  };
}

const library: ProfileSyncLibraryInput = {
  items: [mcpItem('docs'), mcpItem('extra')],
  projectDisabled: [],
};

function account(
  provider: ProfileSyncAccountInput['provider'],
  homeDir: string,
): ProfileSyncAccountInput {
  return { id: `acc-${provider}`, provider, label: provider, homeDir };
}

async function setup(provider: 'claude' | 'qwen' | 'opencode', content: object) {
  const root = await tmp();
  const project = await tmp();
  const home = await tmp();
  await mkdir(join(home, '.qwen'), { recursive: true });
  const target =
    provider === 'claude'
      ? join(home, '.claude.json')
      : provider === 'qwen'
        ? join(home, '.qwen', 'settings.json')
        : join(project, 'opencode.json');
  await writeFile(target, `${JSON.stringify(content, null, 2)}\n`);
  const common = { root, projectPath: project, accounts: [account(provider, home)], library };
  return { root, target, common };
}

describe('a user MCP entry without the marker is never altered', () => {
  for (const provider of ['claude', 'qwen'] as const) {
    it(`reports extra keys of a same-command entry as a conflict (${provider})`, async () => {
      const userOwn = { command: 'run-docs', timeout: 30000, trust: true };
      const { target, common } = await setup(provider, { mcpServers: { docs: userOwn } });
      const before = await readFile(target, 'utf8');

      const preview = await previewProfileSync(common);
      expect(preview.items[0]?.status).toBe('conflict');
      expect(preview.items[0]?.reason).toContain('docs');

      await applyProfileSync({ ...common, approvedIds: [] });
      expect(await readFile(target, 'utf8')).toBe(before);
    });
  }

  it('reports a disabled opencode entry with the same command as a conflict', async () => {
    const userOwn = { type: 'local', command: ['run-docs'], enabled: false };
    const { target, common } = await setup('opencode', { mcp: { docs: userOwn } });
    const before = await readFile(target, 'utf8');

    const preview = await previewProfileSync(common);
    expect(preview.items[0]?.status).toBe('conflict');
    expect(preview.items[0]?.reason).toContain('docs');

    await applyProfileSync({ ...common, approvedIds: [] });
    expect(await readFile(target, 'utf8')).toBe(before);
  });

  it('leaves an identical entry untouched, in its own key order, and does not adopt it', async () => {
    const userOwn = { args: ['-y'], command: 'run-docs' };
    const { root, target, common } = await setup('claude', { mcpServers: { docs: userOwn } });
    const docsLibrary = { items: [mcpItem('docs', ['-y']), mcpItem('extra')], projectDisabled: [] };

    const preview = await previewProfileSync({ ...common, library: docsLibrary });
    expect(preview.items[0]?.status).toBe('update');
    await applyProfileSync({ ...common, library: docsLibrary, approvedIds: ['mcp:acc-claude'] });

    const servers = (JSON.parse(await readFile(target, 'utf8')) as { mcpServers: object })
      .mcpServers as Record<string, object>;
    expect(Object.keys(servers['docs'] ?? {})).toEqual(['args', 'command']);
    expect((await loadManaged(root)).mcp[target]).toEqual(['extra']);
  });

  it('treats an identical entry the user disabled as identical', async () => {
    const userOwn = { command: 'run-docs', disabled: true };
    const { root, target, common } = await setup('qwen', { mcpServers: { docs: userOwn } });

    const preview = await previewProfileSync(common);
    expect(preview.items[0]?.status).toBe('update');
    await applyProfileSync({ ...common, approvedIds: ['mcp:acc-qwen'] });

    const servers = (JSON.parse(await readFile(target, 'utf8')) as { mcpServers: object })
      .mcpServers;
    expect(servers).toMatchObject({ docs: userOwn });
    expect((await loadManaged(root)).mcp[target]).toEqual(['extra']);
  });
});
