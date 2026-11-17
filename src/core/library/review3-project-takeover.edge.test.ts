import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandRunner } from '../providers.js';
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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-review3-takeover-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function mcpItem(id: string): LibraryItem {
  return {
    id,
    kind: 'mcp',
    name: id,
    description: null,
    enabled: true,
    source: 'created',
    definition: { command: `run-${id}` },
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

describe('a project server takes the name over from the library', () => {
  it('drops the name from managed.json when another project writes its own definition', async () => {
    const root = await tmp();
    const projectA = await tmp();
    const projectB = await tmp();
    const home = await tmp();
    const target = join(home, '.claude.json');
    const accounts = [account('claude', home)];
    await syncAll({ root, projectPath: projectA, accounts, library: libraryOf(mcpItem('docs')) });
    await writeFile(
      join(projectB, '.mcp.json'),
      JSON.stringify({ mcpServers: { docs: { command: 'run-docs' } } }),
    );

    await syncAll({ root, projectPath: projectB, accounts, library: libraryOf() });
    expect((await loadManaged(root)).mcp[target]).toEqual([]);

    const { preview } = await syncAll({
      root,
      projectPath: projectA,
      accounts,
      library: libraryOf(),
    });
    expect(preview.items[0]?.status).toBe('unchanged');
    const servers = (JSON.parse(await readFile(target, 'utf8')) as { mcpServers: object })
      .mcpServers;
    expect(servers).toEqual({ docs: { command: 'run-docs' } });
  });

  it('drops the name when the project rewrites it with another definition', async () => {
    const root = await tmp();
    const projectA = await tmp();
    const projectB = await tmp();
    const home = await tmp();
    const target = join(home, '.claude.json');
    const accounts = [account('claude', home)];
    await syncAll({ root, projectPath: projectA, accounts, library: libraryOf(mcpItem('docs')) });
    await writeFile(
      join(projectB, '.mcp.json'),
      JSON.stringify({ mcpServers: { docs: { command: 'project-docs' } } }),
    );

    const { preview } = await syncAll({
      root,
      projectPath: projectB,
      accounts,
      library: libraryOf(),
    });

    expect(preview.items[0]?.status).toBe('update');
    expect((await loadManaged(root)).mcp[target]).toEqual([]);
  });

  it('keeps the name managed while the project rewrite is not approved', async () => {
    const root = await tmp();
    const projectA = await tmp();
    const projectB = await tmp();
    const home = await tmp();
    const target = join(home, '.claude.json');
    const accounts = [account('claude', home)];
    await syncAll({ root, projectPath: projectA, accounts, library: libraryOf(mcpItem('docs')) });
    await writeFile(
      join(projectB, '.mcp.json'),
      JSON.stringify({ mcpServers: { docs: { command: 'project-docs' } } }),
    );

    await applyProfileSync({
      root,
      projectPath: projectB,
      accounts,
      library: libraryOf(),
      approvedIds: [],
    });

    expect((await loadManaged(root)).mcp[target]).toEqual(['docs']);
  });

  it('drops the name when the project server is added through agy', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const listed = new Set<string>();
    const run: CommandRunner['run'] = async (request) => {
      const [, verb, name] = request.args;
      if (verb === 'list') {
        const rows = [...listed].map((entry) => `${entry}  stdio  enabled`);
        return { exitCode: 0, stdout: ['NAME  TYPE   STATUS', ...rows].join('\n') };
      }
      if (verb === 'remove' && name) listed.delete(name);
      if (verb === 'add') listed.add(request.args[request.args.indexOf('--') - 1] ?? '');
      return { exitCode: 0, stdout: '' };
    };
    const accounts = [account('gemini', home)];
    const common = { root, projectPath: project, accounts, runner: { run } };
    await applyProfileSync({
      ...common,
      library: libraryOf(mcpItem('docs')),
      approvedIds: ['mcp:acc-gemini'],
    });
    expect((await loadManaged(root)).mcp['agy:acc-gemini']).toEqual(['docs']);
    await writeFile(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { docs: { command: 'project-docs' } } }),
    );

    await applyProfileSync({ ...common, library: libraryOf(), approvedIds: ['mcp:acc-gemini'] });

    expect((await loadManaged(root)).mcp['agy:acc-gemini']).toEqual([]);
  });
});
