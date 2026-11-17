import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
import { loadManaged, saveManaged } from './managed.js';
import type { LibraryItem } from './types.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-mcp-removal-edge-')));
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

function libraryOf(items: LibraryItem[], projectDisabled: string[] = []): ProfileSyncLibraryInput {
  return { items, projectDisabled };
}

function account(
  provider: ProfileSyncAccountInput['provider'],
  homeDir: string,
): ProfileSyncAccountInput {
  return { id: `acc-${provider}`, provider, label: provider, homeDir };
}

async function jsonServers(path: string, key = 'mcpServers'): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  return parsed[key] as Record<string, unknown>;
}

async function claudeSetup(names: string[]) {
  const root = await tmp();
  const project = await tmp();
  const home = await tmp();
  const target = join(home, '.claude.json');
  const accounts = [account('claude', home)];
  const library = libraryOf(names.map((name) => mcpItem(name)));
  await applyProfileSync({ root, projectPath: project, accounts, library, approvedIds: [] });
  return { root, project, home, target, accounts };
}

describe('planning the removal of managed MCP names', () => {
  it('only prunes managed.json when the managed name is gone from the file', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const target = join(home, '.claude.json');
    const content = JSON.stringify({ mcpServers: { mine: { command: 'mine' } } });
    await writeFile(target, content);
    await saveManaged({ root, targetKey: target, names: ['ghost'] });
    const common = { root, projectPath: project, accounts: [account('claude', home)] };

    const preview = await previewProfileSync({ ...common, library: libraryOf([]) });
    expect(preview.items[0]?.status).toBe('unchanged');
    expect(preview.items[0]?.reason).toBeUndefined();
    await applyProfileSync({ ...common, library: libraryOf([]), approvedIds: [] });

    expect(await readFile(target, 'utf8')).toBe(content);
    expect((await loadManaged(root)).mcp[target]).toEqual([]);
  });

  it('keeps a managed name that now comes from the project .mcp.json', async () => {
    const { root, project, target, accounts } = await claudeSetup(['docs']);
    await writeFile(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { docs: { command: 'from-project' } } }),
    );
    const common = { root, projectPath: project, accounts, library: libraryOf([]) };

    const preview = await previewProfileSync(common);
    expect(preview.items[0]?.reason ?? '').not.toContain('Remove MCP gerenciado');
    await applyProfileSync({ ...common, approvedIds: ['mcp:acc-claude'] });

    expect(await jsonServers(target)).toEqual({ docs: { command: 'from-project' } });
  });

  it('removes and adds in the same apply', async () => {
    const { root, project, target, accounts } = await claudeSetup(['old']);
    const common = { root, projectPath: project, accounts, library: libraryOf([mcpItem('new')]) };

    const preview = await previewProfileSync(common);
    expect(preview.items[0]).toMatchObject({
      status: 'update',
      reason: 'Remove MCP gerenciado: old.',
    });
    await applyProfileSync({ ...common, approvedIds: ['mcp:acc-claude'] });

    expect(Object.keys(await jsonServers(target))).toEqual(['new']);
    expect((await loadManaged(root)).mcp[target]).toEqual(['new']);
  });

  it('binds the approval key to the content after the removal', async () => {
    const { root, project, target, accounts } = await claudeSetup(['a', 'b']);
    const onlyB = { root, projectPath: project, accounts, library: libraryOf([mcpItem('b')]) };
    const none = { ...onlyB, library: libraryOf([]) };
    const keyNone = (await previewProfileSync(none)).items[0]?.approvalKey ?? '';
    const previewB = await previewProfileSync(onlyB);
    expect(previewB.items[0]?.approvalKey).not.toBe(keyNone);

    const stale = await applyProfileSync({ ...onlyB, approvals: 'key', approvedIds: [keyNone] });
    expect(stale.skippedIds).toEqual(['mcp:acc-claude']);
    expect(Object.keys(await jsonServers(target))).toEqual(['a', 'b']);

    const applied = await applyProfileSync({
      ...onlyB,
      approvals: 'key',
      approvedIds: [previewB.items[0]?.approvalKey ?? ''],
    });
    expect(applied.appliedIds).toEqual(['mcp:acc-claude']);
    expect(Object.keys(await jsonServers(target))).toEqual(['b']);
  });

  it('leaves a valid file and keeps the other keys when nothing is retained', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const target = join(home, '.qwen', 'settings.json');
    await mkdir(join(home, '.qwen'), { recursive: true });
    await writeFile(target, JSON.stringify({ model: 'qwen3', mcpServers: {}, theme: 'dark' }));
    const accounts = [account('qwen', home)];
    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library: libraryOf([mcpItem('docs')]),
      approvedIds: ['mcp:acc-qwen'],
    });

    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library: libraryOf([]),
      approvedIds: ['mcp:acc-qwen'],
    });

    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({
      model: 'qwen3',
      mcpServers: {},
      theme: 'dark',
    });
    expect(Object.keys(JSON.parse(await readFile(target, 'utf8')) as object)).toEqual([
      'model',
      'mcpServers',
      'theme',
    ]);
  });

  it('is idempotent and leaves no temp file', async () => {
    const { root, project, home, target, accounts } = await claudeSetup(['docs']);
    const common = { root, projectPath: project, accounts, library: libraryOf([]) };
    await applyProfileSync({ ...common, approvedIds: ['mcp:acc-claude'] });

    const again = await previewProfileSync(common);
    expect(again.items[0]?.status).toBe('unchanged');
    const second = await applyProfileSync({ ...common, approvedIds: ['mcp:acc-claude'] });
    expect(second.skippedIds).toEqual(['mcp:acc-claude']);
    expect((await loadManaged(root)).mcp[target]).toEqual([]);
    expect(await readdir(home)).toEqual(['.claude.json']);
    expect(await readdir(join(root, 'library'))).toEqual(['managed.json']);
  });

  it('does not show secrets of the removed or kept servers in the preview', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const target = join(home, '.claude.json');
    const accounts = [account('claude', home)];
    const secretItem = mcpItem('docs', { command: 'run', env: { TOKEN: 'lib-secret-value' } });
    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library: libraryOf([secretItem]),
      approvedIds: ['mcp:acc-claude'],
    });
    const current = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
    const userServer = { command: 'mine', env: { KEY: 'user-secret-value' } };
    current['mcpServers'] = { ...(current['mcpServers'] as object), mine: userServer };
    current['primaryApiKey'] = 'sk-ant-REALSECRET';
    await writeFile(target, JSON.stringify(current));

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts,
      library: libraryOf([]),
    });

    const text = JSON.stringify(preview.items[0]);
    expect(preview.items[0]?.reason).toBe('Remove MCP gerenciado: docs.');
    for (const secret of ['lib-secret-value', 'user-secret-value', 'REALSECRET']) {
      expect(text).not.toContain(secret);
    }
  });

  it('reports an unreadable file as a conflict and removes nothing', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const target = join(home, '.claude.json');
    await writeFile(target, '{ not json');
    await saveManaged({ root, targetKey: target, names: ['docs'] });
    const common = { root, projectPath: project, accounts: [account('claude', home)] };

    const preview = await previewProfileSync({ ...common, library: libraryOf([]) });
    expect(preview.items[0]).toMatchObject({
      status: 'conflict',
      reason: 'Arquivo de configuração ilegível: .claude.json. Corrija ou restaure o arquivo.',
    });
    await applyProfileSync({ ...common, library: libraryOf([]), approvedIds: ['mcp:acc-claude'] });

    expect(await readFile(target, 'utf8')).toBe('{ not json');
    expect((await loadManaged(root)).mcp[target]).toEqual(['docs']);
  });

  it('does not remove anything without a library', async () => {
    const { root, project, target, accounts } = await claudeSetup(['docs']);
    await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: {} }));

    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      approvedIds: ['mcp:acc-claude'],
    });

    expect(Object.keys(await jsonServers(target))).toEqual(['docs']);
    expect((await loadManaged(root)).mcp[target]).toEqual(['docs']);
  });
});

describe('codex and opencode removal', () => {
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
  ].join('\n');

  it('removes only the managed codex table and its subtables', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    await writeFile(join(home, 'config.toml'), `${userTables}\n`);
    const accounts = [account('codex', home)];
    const withEnv = mcpItem('lib-one', { command: 'run', env: { MODE: 'fast' } });
    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library: libraryOf([withEnv]),
      approvedIds: ['mcp:acc-codex'],
    });
    expect(await readFile(join(home, 'config.toml'), 'utf8')).toContain(
      '[mcp_servers.lib-one.env]',
    );

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts,
      library: libraryOf([]),
    });
    expect(preview.items[0]?.status).toBe('update');
    expect(preview.items[0]?.maskedAfter).not.toContain('lib-one');
    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library: libraryOf([]),
      approvedIds: ['mcp:acc-codex'],
    });

    expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe(`${userTables}\n`);
    expect((await loadManaged(root)).mcp[join(home, 'config.toml')]).toEqual([]);
  });

  it('keeps managed names per opencode project', async () => {
    const root = await tmp();
    const projectA = await tmp();
    const projectB = await tmp();
    const home = await tmp();
    const accounts = [account('opencode', home)];
    const items = [mcpItem('docs')];
    for (const projectPath of [projectA, projectB]) {
      await applyProfileSync({
        root,
        projectPath,
        accounts,
        library: libraryOf(items),
        approvedIds: [],
      });
    }

    await applyProfileSync({
      root,
      projectPath: projectA,
      accounts,
      library: libraryOf(items, ['docs']),
      approvedIds: ['mcp:acc-opencode'],
    });

    expect(await jsonServers(join(projectA, 'opencode.json'), 'mcp')).toEqual({});
    expect(Object.keys(await jsonServers(join(projectB, 'opencode.json'), 'mcp'))).toEqual([
      'docs',
    ]);
    const managed = (await loadManaged(root)).mcp;
    expect(managed[join(projectA, 'opencode.json')]).toEqual([]);
    expect(managed[join(projectB, 'opencode.json')]).toEqual(['docs']);
  });
});

describe('agy removal', () => {
  function fakeAgy(input: { listed: string[]; failing?: string }) {
    const calls: string[] = [];
    const run: CommandRunner['run'] = async (request) => {
      const line = request.args.join(' ');
      calls.push(line);
      if (line === 'mcp list') {
        const rows = input.listed.map((name) => `${name}  stdio  enabled`);
        return { exitCode: 0, stdout: ['NAME  TYPE   STATUS', ...rows].join('\n') };
      }
      return { exitCode: line === `mcp remove ${input.failing}` ? 1 : 0, stdout: '' };
    };
    return { calls, runner: { run } };
  }

  async function agySetup(managedNames: string[]) {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    await saveManaged({ root, targetKey: 'agy:acc-gemini', names: managedNames });
    const common = {
      root,
      projectPath: project,
      accounts: [account('gemini', home)],
      library: libraryOf([]),
    };
    return { root, common };
  }

  it('removes only the marked servers and keeps the failed one marked', async () => {
    const { root, common } = await agySetup(['absent', 'fail', 'gone']);
    const preview = await previewProfileSync(common);
    expect(preview.items[0]).toMatchObject({
      status: 'update',
      reason: 'Remove MCP gerenciado: absent, fail, gone.',
    });
    const agy = fakeAgy({ listed: ['gone', 'fail', 'user-own'], failing: 'fail' });

    const result = await applyProfileSync({
      ...common,
      approvedIds: ['mcp:acc-gemini'],
      runner: agy.runner,
    });

    expect(result.skippedIds).toEqual(['mcp:acc-gemini']);
    expect(agy.calls.filter((call) => call.startsWith('mcp remove')).sort()).toEqual([
      'mcp remove fail',
      'mcp remove gone',
    ]);
    expect((await loadManaged(root)).mcp['agy:acc-gemini']).toEqual(['fail']);
  });

  it('is unchanged after a successful removal', async () => {
    const { root, common } = await agySetup(['gone']);
    const agy = fakeAgy({ listed: ['gone'] });

    const result = await applyProfileSync({
      ...common,
      approvedIds: ['mcp:acc-gemini'],
      runner: agy.runner,
    });

    expect(result.appliedIds).toEqual(['mcp:acc-gemini']);
    expect((await loadManaged(root)).mcp['agy:acc-gemini']).toEqual([]);
    expect((await previewProfileSync(common)).items[0]?.status).toBe('unchanged');
  });

  it('keeps the approval key of agy bound to the names to remove', async () => {
    const first = await agySetup(['one']);
    const second = await agySetup(['two']);
    const keyOne = (await previewProfileSync(first.common)).items[0]?.approvalKey;
    const keyTwo = (await previewProfileSync(second.common)).items[0]?.approvalKey;
    expect(keyOne).not.toBe(keyTwo);
  });
});
