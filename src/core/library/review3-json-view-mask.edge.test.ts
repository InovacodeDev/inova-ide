import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProfileSync,
  previewProfileSync,
  type ProfileSyncAccountInput,
  type ProfileSyncItem,
} from '../profile-sync.js';
import type { LibraryItem } from './types.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-review3-json-view-')));
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

const library = { items: [docs], projectDisabled: [] };

function account(
  provider: ProfileSyncAccountInput['provider'],
  homeDir: string,
): ProfileSyncAccountInput {
  return { id: `acc-${provider}`, provider, label: provider, homeDir };
}

function viewText(item: ProfileSyncItem | undefined): string {
  return `${item?.maskedBefore ?? ''}\n${item?.maskedAfter ?? ''}`;
}

describe('the JSON preview masks args and url without changing what is written', () => {
  it('masks bearer args and url secrets of a user server', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const target = join(home, '.claude.json');
    const userServers = {
      mine: { command: 'npx', args: ['--header', 'Authorization: Bearer ghp_ARGSECRET0000'] },
      web: { type: 'http', url: 'https://me:URLPASS@x.example/mcp?api_key=URLSECRET' },
    };
    await writeFile(target, JSON.stringify({ mcpServers: userServers }));
    const common = { root, projectPath: project, accounts: [account('claude', home)], library };

    const preview = await previewProfileSync(common);

    const text = viewText(preview.items[0]);
    for (const secret of ['ARGSECRET', 'URLSECRET', 'URLPASS']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('https://***@x.example/mcp?api_key=***');
    await applyProfileSync({ ...common, approvedIds: ['mcp:acc-claude'] });
    const written = JSON.parse(await readFile(target, 'utf8')) as { mcpServers: object };
    expect(written.mcpServers).toMatchObject(userServers);
  });

  it('masks args of project servers in the agy preview', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const proj = { command: 'npx', args: ['Authorization: Bearer PROJARGSECRET'] };
    await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { proj } }));

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts: [account('gemini', home)],
      library,
    });

    expect(viewText(preview.items[0])).not.toContain('PROJARGSECRET');
    expect(preview.items[0]?.maskedAfter).toContain('proj');
  });
});
