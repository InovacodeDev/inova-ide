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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-review-fixes-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function mcpItem(id: string, command = `run-${id}`): LibraryItem {
  return {
    id,
    kind: 'mcp',
    name: id,
    description: null,
    enabled: true,
    source: 'created',
    definition: { command, args: ['-y', id] },
    updatedAt: '2026-11-17T10:00:00.000Z',
  };
}

function libraryOf(...items: LibraryItem[]): { items: LibraryItem[]; projectDisabled: string[] } {
  return { items, projectDisabled: [] };
}

function account(
  provider: ProfileSyncAccountInput['provider'],
  homeDir: string,
): ProfileSyncAccountInput {
  return { id: `acc-${provider}`, provider, label: provider, homeDir };
}

describe('managed names are indexed by target', () => {
  it('a name marked in the opencode.json of project A is a conflict in project B', async () => {
    const root = await tmp();
    const projectA = await tmp();
    const projectB = await tmp();
    const home = await tmp();
    const userOwn = { mcp: { tool: { type: 'local', command: ['my-own-tool', '--real'] } } };
    await writeFile(join(projectB, 'opencode.json'), `${JSON.stringify(userOwn, null, 2)}\n`);
    const before = await readFile(join(projectB, 'opencode.json'), 'utf8');
    const accounts = [account('opencode', home)];
    const library = libraryOf(mcpItem('tool', 'lib-tool'));

    await applyProfileSync({ root, projectPath: projectA, accounts, library, approvedIds: [] });
    expect((await loadManaged(root)).mcp).toEqual({
      [join(projectA, 'opencode.json')]: ['tool'],
    });

    const preview = await previewProfileSync({ root, projectPath: projectB, accounts, library });
    const item = preview.items.find((entry) => entry.id === 'mcp:acc-opencode');
    expect(item?.status).toBe('conflict');
    expect(item?.reason).toContain('tool');

    await applyProfileSync({ root, projectPath: projectB, accounts, library, approvedIds: [] });
    expect(await readFile(join(projectB, 'opencode.json'), 'utf8')).toBe(before);
  });

  it('marks agy servers under agy:<accountId>', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const run = async (request: { args: readonly string[] }) =>
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

    expect((await loadManaged(root)).mcp).toEqual({ 'agy:acc-gemini': ['fresh'] });
  });
});

describe('a user server with the same definition is not adopted', () => {
  it('keeps lib-one unmanaged and reports a conflict once the library definition changes', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const target = join(home, '.claude.json');
    const userOwn = {
      mcpServers: { 'lib-one': { command: 'run-lib-one', args: ['-y', 'lib-one'] } },
    };
    await writeFile(target, `${JSON.stringify(userOwn, null, 2)}\n`);
    const accounts = [account('claude', home)];

    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library: libraryOf(mcpItem('lib-one'), mcpItem('lib-two')),
      approvedIds: ['mcp:acc-claude'],
    });
    expect((await loadManaged(root)).mcp[target]).toEqual(['lib-two']);

    const changed = libraryOf(mcpItem('lib-one', 'changed'), mcpItem('lib-two'));
    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts,
      library: changed,
    });
    const item = preview.items.find((entry) => entry.id === 'mcp:acc-claude');
    expect(item?.status).toBe('conflict');
    expect(item?.reason).toContain('lib-one');

    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library: changed,
      approvedIds: [],
    });
    const servers = (JSON.parse(await readFile(target, 'utf8')) as typeof userOwn).mcpServers;
    expect(servers['lib-one'].command).toBe('run-lib-one');
  });

  it('treats an unparseable user entry with the same name as a conflict', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const userOwn = { mcp: { tool: { type: 'future-kind', endpoint: 'x' } } };
    await writeFile(join(project, 'opencode.json'), `${JSON.stringify(userOwn, null, 2)}\n`);
    const before = await readFile(join(project, 'opencode.json'), 'utf8');
    const accounts = [account('opencode', home)];
    const library = libraryOf(mcpItem('tool'));

    const preview = await previewProfileSync({ root, projectPath: project, accounts, library });
    expect(preview.items.find((entry) => entry.id === 'mcp:acc-opencode')?.status).toBe('conflict');
    await applyProfileSync({ root, projectPath: project, accounts, library, approvedIds: [] });
    expect(await readFile(join(project, 'opencode.json'), 'utf8')).toBe(before);
    expect((await loadManaged(root)).mcp).toEqual({});
  });
});

describe('codex keeps the MCP tables of the user', () => {
  const userTables = [
    'model = "gpt-5"',
    '',
    '[mcp_servers.github]',
    'command = "gh-mcp"',
    '',
    '[mcp_servers.github.env]',
    'GITHUB_TOKEN = "real-secret"',
    '',
    '[mcp_servers."a.b"]',
    'command = "dotted"',
    '',
    '[mcp_servers."a.b".env]',
    'K = "v"',
  ].join('\n');

  async function codexSetup(toml: string) {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    await writeFile(join(home, 'config.toml'), toml);
    return { root, project, home, accounts: [account('codex', home)] };
  }

  it('preserves unmanaged tables and subtables verbatim and stays idempotent', async () => {
    const { root, project, home, accounts } = await codexSetup(`${userTables}\n`);
    const library = libraryOf(mcpItem('lib-one'));

    const applied = await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: ['mcp:acc-codex'],
    });
    expect(applied.appliedIds).toContain('mcp:acc-codex');
    const toml = await readFile(join(home, 'config.toml'), 'utf8');
    expect(toml.startsWith(userTables)).toBe(true);
    expect(toml).toContain('[mcp_servers.lib-one]');
    expect((await loadManaged(root)).mcp[join(home, 'config.toml')]).toEqual(['lib-one']);

    const again = await previewProfileSync({ root, projectPath: project, accounts, library });
    expect(again.items.find((entry) => entry.id === 'mcp:acc-codex')?.status).toBe('unchanged');
  });

  it('replaces an approved conflicting table and keeps the user comment that follows it', async () => {
    const managedFirst = [
      '[mcp_servers.lib-one]',
      'command = "old"',
      '',
      '# my github server',
      '[mcp_servers.github]',
      'command = "gh-mcp"',
      '',
    ].join('\n');
    const { root, project, home, accounts } = await codexSetup(managedFirst);
    const library = libraryOf(mcpItem('lib-one'));
    await applyProfileSync({ root, projectPath: project, accounts, library, approvedIds: [] });
    expect(
      (await previewProfileSync({ root, projectPath: project, accounts, library })).items[0]
        ?.status,
    ).toBe('conflict');
    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: ['mcp:acc-codex'],
    });

    const toml = await readFile(join(home, 'config.toml'), 'utf8');
    expect(toml).not.toContain('command = "old"');
    expect(toml).toContain('# my github server\n[mcp_servers.github]\ncommand = "gh-mcp"');
    expect(toml.match(/\[mcp_servers\.lib-one\]/g)).toHaveLength(1);
  });

  it('removes a managed table that is no longer projected and keeps the user tables', async () => {
    const { root, project, home, accounts } = await codexSetup(`${userTables}\n`);
    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library: libraryOf(mcpItem('old-one'), mcpItem('lib-one')),
      approvedIds: ['mcp:acc-codex'],
    });

    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library: libraryOf(mcpItem('lib-one')),
      approvedIds: ['mcp:acc-codex'],
    });

    const toml = await readFile(join(home, 'config.toml'), 'utf8');
    expect(toml).not.toContain('old-one');
    expect(toml.startsWith(userTables)).toBe(true);
  });

  it('reports a conflict instead of writing when a library name is defined inline', async () => {
    const inline = '[mcp_servers]\nlib-one = { command = "inline" }\n';
    const { root, project, home, accounts } = await codexSetup(inline);
    const library = libraryOf(mcpItem('lib-one'));

    const preview = await previewProfileSync({ root, projectPath: project, accounts, library });
    expect(preview.items[0]?.status).toBe('conflict');
    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: ['mcp:acc-codex'],
    });
    expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe(inline);
  });

  it('keeps the legacy rewrite when no library is given', async () => {
    const { root, project, home, accounts } = await codexSetup(`${userTables}\n`);
    await writeFile(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { proj: { command: 'x' } } }),
    );

    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      approvedIds: ['mcp:acc-codex'],
    });

    const toml = await readFile(join(home, 'config.toml'), 'utf8');
    expect(toml).toBe('model = "gpt-5"\n\n[mcp_servers.proj]\ncommand = "x"\n');
  });
});
