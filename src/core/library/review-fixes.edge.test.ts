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
