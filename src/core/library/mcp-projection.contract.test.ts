import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProfileSync,
  previewProfileSync,
  type ProfileSyncAccountInput,
} from '../profile-sync.js';
import { loadManaged } from './managed.js';
import type { LibraryItem } from './types.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-mcp-projection-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function mcpItem(id: string, overrides: { enabled?: boolean; command?: string } = {}): LibraryItem {
  return {
    id,
    kind: 'mcp',
    name: id,
    description: null,
    enabled: overrides.enabled ?? true,
    source: 'created',
    definition: { command: overrides.command ?? `run-${id}`, args: ['--flag'] },
    updatedAt: '2026-11-17T10:00:00.000Z',
  };
}

async function readClaudeServers(homeDir: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(homeDir, '.claude.json'), 'utf8');
  return (JSON.parse(raw) as { mcpServers: Record<string, unknown> }).mcpServers;
}

function claudeAccount(id: string, homeDir: string): ProfileSyncAccountInput {
  return { id, provider: 'claude', label: id, homeDir };
}

describe('library MCP projection contract', () => {
  it('rule 2: only items enabled in the library, project and account reach the account', async () => {
    const root = await tmp();
    const project = await tmp();
    const homeA = await tmp();
    const homeB = await tmp();
    const accounts: ProfileSyncAccountInput[] = [
      claudeAccount('acc-a', homeA),
      {
        ...claudeAccount('acc-b', homeB),
        disabledCapabilities: [{ kind: 'mcp', id: 'by-account' }],
      },
    ];
    const library = {
      items: [
        mcpItem('on-everywhere'),
        mcpItem('off-in-library', { enabled: false }),
        mcpItem('off-in-project'),
        mcpItem('by-account'),
      ],
      projectDisabled: ['off-in-project'],
    };

    const preview = await previewProfileSync({ root, projectPath: project, accounts, library });
    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: preview.items.map((item) => item.id),
    });

    expect(Object.keys(await readClaudeServers(homeA)).sort()).toEqual([
      'by-account',
      'on-everywhere',
    ]);
    expect(Object.keys(await readClaudeServers(homeB))).toEqual(['on-everywhere']);
  });

  it('rule 3: a project .mcp.json server wins over a library item with the same name', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    await writeFile(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { shared: { command: 'from-project' } } }),
    );
    const accounts = [claudeAccount('acc-a', home)];
    const library = {
      items: [mcpItem('shared', { command: 'from-library' }), mcpItem('library-only')],
      projectDisabled: [],
    };

    const preview = await previewProfileSync({ root, projectPath: project, accounts, library });
    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: preview.items.map((item) => item.id),
    });

    const servers = await readClaudeServers(home);
    expect(servers['shared']).toEqual({ command: 'from-project' });
    expect(servers['library-only']).toMatchObject({ command: 'run-library-only' });
  });

  it('rule 7: a provider without MCP support is incompatible with a reason and the others still sync', async () => {
    const root = await tmp();
    const project = await tmp();
    const claudeHome = await tmp();
    const deepseekHome = await tmp();
    const accounts: ProfileSyncAccountInput[] = [
      claudeAccount('acc-claude', claudeHome),
      { id: 'acc-deepseek', provider: 'deepseek', label: 'ds', homeDir: deepseekHome },
    ];
    const library = { items: [mcpItem('docs')], projectDisabled: [] };

    const preview = await previewProfileSync({ root, projectPath: project, accounts, library });
    const claude = preview.items.find((item) => item.id === 'mcp:acc-claude');
    const deepseek = preview.items.find((item) => item.id === 'mcp:acc-deepseek');
    expect(claude?.status).toBe('create');
    expect(deepseek?.status).toBe('incompatible');
    expect(deepseek?.reason).toMatch(/não verificado/);

    const applied = await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: preview.items.map((item) => item.id),
    });
    expect(applied.appliedIds).toContain('mcp:acc-claude');
    expect(applied.skippedIds).toContain('mcp:acc-deepseek');
    expect(Object.keys(await readClaudeServers(claudeHome))).toEqual(['docs']);
  });

  it('rule 4: an unmarked server with the same name and another definition is never overwritten without approval', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const userOwn = { mcpServers: { docs: { command: 'user-own' }, mine: { command: 'mine' } } };
    await writeFile(join(home, '.claude.json'), `${JSON.stringify(userOwn, null, 2)}\n`);
    const before = await readFile(join(home, '.claude.json'), 'utf8');
    const accounts = [claudeAccount('acc-a', home)];
    const library = { items: [mcpItem('docs', { command: 'from-library' })], projectDisabled: [] };

    const preview = await previewProfileSync({ root, projectPath: project, accounts, library });
    const item = preview.items.find((entry) => entry.id === 'mcp:acc-a');
    expect(item?.status).toBe('conflict');
    expect(item?.reason).toContain('docs');

    const refused = await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: [],
    });
    expect(refused.skippedIds).toContain('mcp:acc-a');
    expect(await readFile(join(home, '.claude.json'), 'utf8')).toBe(before);
    expect((await loadManaged(root)).mcp).toEqual({});

    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: ['mcp:acc-a'],
    });
    const servers = await readClaudeServers(home);
    expect(servers['docs']).toMatchObject({ command: 'from-library' });
    expect(servers['mine']).toEqual({ command: 'mine' });
    expect((await loadManaged(root)).mcp['acc-a']).toEqual(['docs']);
  });

  it('rule 4: a server marked as managed is updated without conflict', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const accounts = [claudeAccount('acc-a', home)];
    const first = { items: [mcpItem('docs', { command: 'v1' })], projectDisabled: [] };
    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library: first,
      approvedIds: ['mcp:acc-a'],
    });

    const second = { items: [mcpItem('docs', { command: 'v2' })], projectDisabled: [] };
    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts,
      library: second,
    });
    expect(preview.items.find((entry) => entry.id === 'mcp:acc-a')?.status).toBe('update');
  });
});
