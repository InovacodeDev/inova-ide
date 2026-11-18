import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandRunner } from '../providers.js';
import {
  applyProfileSync,
  previewProfileSync,
  type McpServerConfig,
  type ProfileSyncAccountInput,
} from '../profile-sync.js';
import { loadManaged, managedFile, saveManaged } from './managed.js';
import { mergeLibraryMcp } from './mcp.js';
import { LibraryCorruptError } from './store.js';
import type { LibraryItem } from './types.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-mcp-edge-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const UPDATED_AT = '2026-11-17T10:00:00.000Z';

function mcpItem(id: string, definition: McpServerConfig = { command: `run-${id}` }): LibraryItem {
  return {
    id,
    kind: 'mcp',
    name: id,
    description: null,
    enabled: true,
    source: 'created',
    definition,
    updatedAt: UPDATED_AT,
  };
}

function connectorItem(id: string): LibraryItem {
  return {
    id,
    kind: 'connector',
    name: id,
    label: id,
    description: null,
    enabled: true,
    source: 'created',
    definition: { type: 'http', url: 'https://mcp.example.com/mcp' },
    updatedAt: UPDATED_AT,
  };
}

function varItem(id: string): LibraryItem {
  return mcpItem(id, { command: 'npx', env: { API_TOKEN: '${API_TOKEN}' } });
}

function account(
  provider: ProfileSyncAccountInput['provider'],
  homeDir: string,
): ProfileSyncAccountInput {
  return { id: `acc-${provider}`, provider, label: provider, homeDir };
}

function libraryOf(...items: LibraryItem[]): { items: LibraryItem[]; projectDisabled: string[] } {
  return { items, projectDisabled: [] };
}

describe('mergeLibraryMcp', () => {
  it('does not mutate its inputs and ignores skills, plugins and disabled items', () => {
    const projectServers = { own: { command: 'own' } };
    const items: LibraryItem[] = [
      mcpItem('lib'),
      { ...mcpItem('off'), enabled: false },
      {
        id: 'a-skill',
        kind: 'skill',
        name: 's',
        description: null,
        enabled: true,
        source: 'created',
        definition: { hash: 'a1b2c3d4e5f60718' },
        updatedAt: UPDATED_AT,
      },
    ];
    const projectSnapshot = structuredClone(projectServers);
    const itemsSnapshot = structuredClone(items);

    const merged = mergeLibraryMcp({ projectServers, items });

    expect(Object.keys(merged).sort()).toEqual(['lib', 'own']);
    expect(projectServers).toEqual(projectSnapshot);
    expect(items).toEqual(itemsSnapshot);
    expect(merged['lib']).not.toBe((items[0] as { definition: unknown }).definition);
  });

  it('projects a connector as a remote server named after its id', () => {
    const merged = mergeLibraryMcp({ projectServers: {}, items: [connectorItem('gmail')] });
    expect(merged).toEqual({ gmail: { type: 'http', url: 'https://mcp.example.com/mcp' } });
  });
});

describe('library MCP projection edges', () => {
  it('writes an http connector into the claude account', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const accounts = [account('claude', home)];
    const library = libraryOf(connectorItem('gmail'));

    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: ['mcp:acc-claude'],
    });

    const written = JSON.parse(await readFile(join(home, '.claude.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(written.mcpServers['gmail']).toEqual({
      type: 'http',
      url: 'https://mcp.example.com/mcp',
    });
  });

  it('projects library items when .mcp.json does not exist', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const accounts = [account('claude', home)];

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts,
      library: libraryOf(mcpItem('docs')),
    });

    expect(preview.mcpSourceExists).toBe(false);
    expect(preview.mcpServerCount).toBe(0);
    expect(preview.items.find((item) => item.id === 'mcp:acc-claude')?.status).toBe('create');
  });

  it('marks a ${VAR} item incompatible per item on a provider without verified expansion', async () => {
    const root = await tmp();
    const project = await tmp();
    const codexHome = await tmp();
    const claudeHome = await tmp();
    const accounts = [account('codex', codexHome), account('claude', claudeHome)];

    const onlyVar = await previewProfileSync({
      root,
      projectPath: project,
      accounts,
      library: libraryOf(varItem('secret-server')),
    });
    const codexOnly = onlyVar.items.find((item) => item.id === 'mcp:acc-codex');
    expect(codexOnly?.status).toBe('incompatible');
    expect(codexOnly?.reason).toContain('variável ${VAR} não verificada neste provider');
    expect(onlyVar.items.find((item) => item.id === 'mcp:acc-claude')?.status).toBe('create');

    const library = libraryOf(varItem('secret-server'), mcpItem('plain'));
    const mixed = await previewProfileSync({ root, projectPath: project, accounts, library });
    expect(mixed.items.find((item) => item.id === 'mcp:acc-codex')?.status).toBe('create');
    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: mixed.items.map((item) => item.id),
    });
    const toml = await readFile(join(codexHome, 'config.toml'), 'utf8');
    expect(toml).toContain('[mcp_servers.plain]');
    expect(toml).not.toContain('secret-server');
    expect(await readFile(join(claudeHome, '.claude.json'), 'utf8')).toContain('${API_TOKEN}');
    expect((await loadManaged(root)).mcp[join(codexHome, 'config.toml')]).toEqual(['plain']);
  });

  it('does not apply the ${VAR} rule to servers from the project .mcp.json', async () => {
    const root = await tmp();
    const project = await tmp();
    const codexHome = await tmp();
    await writeFile(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { own: { command: 'npx', env: { K: '${K}' } } } }),
    );

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts: [account('codex', codexHome)],
      library: libraryOf(mcpItem('plain')),
    });

    const item = preview.items.find((entry) => entry.id === 'mcp:acc-codex');
    expect(item?.status).toBe('create');
    expect(item?.reason).toBeUndefined();
  });

  it('does not mark a library server that the provider adapter could not write', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const accounts = [account('codex', home)];
    const sseConnector: LibraryItem = {
      ...connectorItem('legacy'),
      definition: { type: 'sse', url: 'https://legacy.example.com/sse' },
    } as LibraryItem;
    const library = libraryOf(sseConnector, mcpItem('plain'));

    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: ['mcp:acc-codex'],
    });

    expect((await loadManaged(root)).mcp[join(home, 'config.toml')]).toEqual(['plain']);
    const preview = await previewProfileSync({ root, projectPath: project, accounts, library });
    expect(preview.items.find((item) => item.id === 'mcp:acc-codex')?.status).toBe('unchanged');
  });

  it('throws LibraryCorruptError when managed.json is corrupt', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    await mkdir(join(root, 'library'), { recursive: true });
    await writeFile(managedFile(root), '{not json');

    await expect(
      previewProfileSync({
        root,
        projectPath: project,
        accounts: [account('claude', home)],
        library: libraryOf(mcpItem('docs')),
      }),
    ).rejects.toBeInstanceOf(LibraryCorruptError);

    await writeFile(managedFile(root), JSON.stringify({ version: 2, mcp: {} }));
    await expect(loadManaged(root)).rejects.toBeInstanceOf(LibraryCorruptError);
    await writeFile(managedFile(root), JSON.stringify({ version: 1, mcp: { a: [1] } }));
    await expect(loadManaged(root)).rejects.toBeInstanceOf(LibraryCorruptError);
  });

  it('treats managed as empty when no root is given', async () => {
    const project = await tmp();
    const home = await tmp();
    await writeFile(
      join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { docs: { command: 'user-own' } } }),
    );

    const preview = await previewProfileSync({
      projectPath: project,
      accounts: [account('claude', home)],
      library: libraryOf(mcpItem('docs')),
    });

    expect(preview.items.find((item) => item.id === 'mcp:acc-claude')?.status).toBe('conflict');
  });

  it('does not report a conflict when the unmarked server has the same definition', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    await writeFile(
      join(home, '.claude.json'),
      `${JSON.stringify({ mcpServers: { docs: { command: 'run-docs' } } }, null, 2)}\n`,
    );

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts: [account('claude', home)],
      library: libraryOf(mcpItem('docs')),
    });

    expect(preview.items.find((item) => item.id === 'mcp:acc-claude')?.status).toBe('unchanged');
  });

  it('reports a conflict for an unmarked codex table with the same name', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    await writeFile(join(home, 'config.toml'), '[mcp_servers.docs]\ncommand = "user-own"\n');
    const accounts = [account('codex', home)];
    const library = libraryOf(mcpItem('docs'));

    const preview = await previewProfileSync({ root, projectPath: project, accounts, library });
    expect(preview.items.find((item) => item.id === 'mcp:acc-codex')?.status).toBe('conflict');

    const refused = await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: [],
    });
    expect(refused.appliedIds).toEqual([]);
    expect(await readFile(join(home, 'config.toml'), 'utf8')).toContain('user-own');
  });

  it('applies with approval, merges managed names and leaves no temp file', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const accounts = [account('claude', home)];
    await saveManaged({ root, targetKey: join(home, '.claude.json'), names: ['older'] });
    await writeFile(
      join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { docs: { command: 'user-own' } } }),
    );
    const library = { items: [mcpItem('docs'), mcpItem('older')], projectDisabled: ['older'] };

    const applied = await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: ['mcp:acc-claude'],
    });

    expect(applied.appliedIds).toEqual(['mcp:acc-claude']);
    expect((await loadManaged(root)).mcp[join(home, '.claude.json')]).toEqual(['docs', 'older']);
    expect(await readdir(home)).toEqual(['.claude.json']);
    expect(await readdir(join(root, 'library'))).toEqual(['managed.json']);
  });

  it('backs up the previous managed.json before writing', async () => {
    const root = await tmp();
    await saveManaged({ root, targetKey: 'a', names: ['one'] });
    const first = await readFile(managedFile(root), 'utf8');

    await saveManaged({ root, targetKey: 'a', names: ['one', 'two'] });

    const backups = await readdir(join(root, 'backups', 'library'));
    expect(backups).toHaveLength(1);
    const copy = await readFile(join(root, 'backups', 'library', backups[0] ?? '', 'managed.json'));
    expect(copy.toString()).toBe(first);
  });

  it('does not rewrite managed.json when the names did not change', async () => {
    const root = await tmp();
    await saveManaged({ root, targetKey: 'a', names: ['one'] });
    await saveManaged({ root, targetKey: 'a', names: ['one'] });
    await expect(readdir(join(root, 'backups', 'library'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('skips an agy server whose name already exists unmarked and does not mark it', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const accounts = [account('gemini', home)];
    const library = libraryOf(mcpItem('docs'), mcpItem('fresh'));
    const calls: string[] = [];
    const run = vi.fn<CommandRunner['run']>(async (request) => {
      calls.push(request.args.join(' '));
      if (request.args.join(' ') === 'mcp list') {
        return { exitCode: 0, stdout: 'NAME  TYPE   STATUS\ndocs  stdio  enabled\n' };
      }
      return { exitCode: 0, stdout: '' };
    });

    const applied = await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: ['mcp:acc-gemini'],
      runner: { run },
    });

    expect(applied.skippedIds).toContain('mcp:acc-gemini');
    expect(calls.some((call) => call.startsWith('mcp remove docs'))).toBe(false);
    expect(calls.some((call) => call.startsWith('mcp add') && call.includes(' fresh '))).toBe(true);
    expect((await loadManaged(root)).mcp['agy:acc-gemini']).toEqual(['fresh']);
  });
});
