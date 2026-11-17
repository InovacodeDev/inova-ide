import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandRunner } from '../providers.js';
import {
  applyProfileSync,
  previewProfileSync,
  type McpServerConfig,
  type ProfileSyncAccountInput,
  type ProfileSyncLibraryInput,
} from '../profile-sync.js';
import { loadManaged } from './managed.js';
import type { LibraryItem } from './types.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-review3-hash-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function mcpItem(id: string, definition: McpServerConfig = { command: `run-${id}` }): LibraryItem {
  return {
    id,
    kind: 'mcp',
    name: id,
    description: null,
    enabled: true,
    source: 'created',
    definition,
    updatedAt: '2026-11-17T10:00:00.000Z',
  };
}

function libraryOf(...items: LibraryItem[]): ProfileSyncLibraryInput {
  return { items, projectDisabled: [] };
}

function account(
  provider: ProfileSyncAccountInput['provider'],
  homeDir: string,
): ProfileSyncAccountInput {
  return { id: `acc-${provider}`, provider, label: provider, homeDir };
}

async function syncAll(input: {
  root: string;
  projectPath: string;
  accounts: ProfileSyncAccountInput[];
  library: ProfileSyncLibraryInput;
}) {
  const preview = await previewProfileSync(input);
  const result = await applyProfileSync({
    ...input,
    approvals: 'key',
    approvedIds: preview.items.map((item) => item.approvalKey),
  });
  return { preview, result };
}

async function readServers(path: string, key = 'mcpServers'): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  return parsed[key] as Record<string, unknown>;
}

function targetOf(
  provider: 'claude' | 'qwen' | 'codex' | 'opencode',
  home: string,
  project: string,
) {
  switch (provider) {
    case 'claude':
      return join(home, '.claude.json');
    case 'qwen':
      return join(home, '.qwen', 'settings.json');
    case 'codex':
      return join(home, 'config.toml');
    case 'opencode':
      return join(project, 'opencode.json');
  }
}

describe('managed.json keeps the hash of the projected definition', () => {
  it('does not remove a server the user recreated with another definition (claude)', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const target = join(home, '.claude.json');
    await writeFile(target, JSON.stringify({ mcpServers: {} }));
    const accounts = [account('claude', home)];
    await syncAll({ root, projectPath: project, accounts, library: libraryOf(mcpItem('docs')) });
    expect((await loadManaged(root)).hashes[target]?.['docs']).toMatch(/^[0-9a-f]{32}$/);

    const config = JSON.parse(await readFile(target, 'utf8')) as { mcpServers: object };
    const mine = { command: 'my-own-docs', args: ['--mine'] };
    await writeFile(target, JSON.stringify({ mcpServers: { ...config.mcpServers, docs: mine } }));
    const userBytes = await readFile(target, 'utf8');

    const { preview } = await syncAll({
      root,
      projectPath: project,
      accounts,
      library: libraryOf(),
    });

    expect(preview.items[0]?.status).toBe('unchanged');
    expect(preview.items[0]?.reason ?? '').not.toContain('Remove MCP gerenciado');
    expect(await readFile(target, 'utf8')).toBe(userBytes);
    expect((await loadManaged(root)).mcp[target]).toEqual([]);
    expect((await loadManaged(root)).hashes[target]).toEqual({});
  });

  it('does not strip a codex table the user rewrote after the projection', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const target = join(home, 'config.toml');
    const accounts = [account('codex', home)];
    await syncAll({ root, projectPath: project, accounts, library: libraryOf(mcpItem('docs')) });
    const mine = 'model = "o3"\n\n[mcp_servers.docs]\ncommand = "mine"\n';
    await writeFile(target, mine);

    const { preview } = await syncAll({
      root,
      projectPath: project,
      accounts,
      library: libraryOf(),
    });

    expect(preview.items[0]?.status).toBe('unchanged');
    expect(await readFile(target, 'utf8')).toBe(mine);
    expect((await loadManaged(root)).mcp[target]).toEqual([]);
  });

  it('keeps the codex hash when the user only disables the managed server', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const target = join(home, 'config.toml');
    const accounts = [account('codex', home)];
    await syncAll({ root, projectPath: project, accounts, library: libraryOf(mcpItem('docs')) });
    const written = await readFile(target, 'utf8');
    await writeFile(
      target,
      written.replace('command = "run-docs"', 'command = "run-docs"\nenabled = false'),
    );

    await syncAll({ root, projectPath: project, accounts, library: libraryOf() });

    expect(await readFile(target, 'utf8')).not.toContain('docs');
  });

  it('updates the hash when a managed server is rewritten with a new definition', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const target = join(home, '.claude.json');
    const accounts = [account('claude', home)];
    const common = { root, projectPath: project, accounts };
    await syncAll({ ...common, library: libraryOf(mcpItem('docs', { command: 'v1' })) });
    const first = (await loadManaged(root)).hashes[target]?.['docs'];
    await syncAll({ ...common, library: libraryOf(mcpItem('docs', { command: 'v2' })) });
    expect((await loadManaged(root)).hashes[target]?.['docs']).not.toBe(first);

    await syncAll({ ...common, library: libraryOf() });

    expect(await readServers(target)).toEqual({});
  });

  for (const provider of ['claude', 'qwen', 'codex', 'opencode'] as const) {
    it(`removes what it wrote when the projection drops defaults (${provider})`, async () => {
      const root = await tmp();
      const project = await tmp();
      const home = await tmp();
      await mkdir(join(home, '.qwen'), { recursive: true });
      const accounts = [account(provider, home)];
      const items = [
        mcpItem('local', { type: 'stdio', command: 'run', args: [], env: {} }),
        mcpItem('remote', { type: 'http', url: 'https://x.example/mcp', headers: { A: 'b' } }),
      ];
      await syncAll({ root, projectPath: project, accounts, library: libraryOf(...items) });
      const target = targetOf(provider, home, project);
      expect((await loadManaged(root)).mcp[target]).toEqual(['local', 'remote']);

      const { preview } = await syncAll({
        root,
        projectPath: project,
        accounts,
        library: libraryOf(),
      });

      expect(preview.items[0]?.reason).toBe('Remove MCP gerenciado: local, remote.');
      const text = await readFile(target, 'utf8');
      expect(text).not.toContain('local');
      expect(text).not.toContain('remote');
    });
  }

  it('stores an empty hash for agy because the CLI does not expose the definition', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const run: CommandRunner['run'] = async (request) =>
      request.args.join(' ') === 'mcp list'
        ? { exitCode: 0, stdout: 'NAME  TYPE   STATUS\n' }
        : { exitCode: 0, stdout: '' };

    await applyProfileSync({
      root,
      projectPath: project,
      accounts: [account('gemini', home)],
      library: libraryOf(mcpItem('fresh')),
      approvedIds: ['mcp:acc-gemini'],
      runner: { run },
    });

    const managed = await loadManaged(root);
    expect(managed.mcp['agy:acc-gemini']).toEqual(['fresh']);
    expect(managed.hashes['agy:acc-gemini']).toEqual({ fresh: '' });
  });
});
