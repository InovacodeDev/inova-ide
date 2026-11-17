import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { previewProfileSync, type ProfileSyncAccountInput } from '../profile-sync.js';
import type { LibraryItem } from './types.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-preview-view-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const library = {
  items: [
    {
      id: 'docs',
      kind: 'mcp',
      name: 'docs',
      description: null,
      enabled: true,
      source: 'created',
      definition: { command: 'run-docs' },
      updatedAt: '2026-11-17T10:00:00.000Z',
    } satisfies LibraryItem,
  ],
  projectDisabled: [],
};

function account(
  provider: ProfileSyncAccountInput['provider'],
  homeDir: string,
): ProfileSyncAccountInput {
  return { id: `acc-${provider}`, provider, label: provider, homeDir };
}

const claudeJson = {
  primaryApiKey: 'sk-ant-api03-REALSECRET',
  oauthAccount: { emailAddress: 'user@example.com' },
  projects: { '/secret/path': { history: ['private prompt'] } },
  mcpServers: { mine: { command: 'mine', env: { TOKEN: 'env-secret-value' } } },
};

const PRIVATE_TEXT = [
  'REALSECRET',
  'primaryApiKey',
  'oauthAccount',
  'user@example.com',
  'private prompt',
  '/secret/path',
  'env-secret-value',
];

describe('library preview shows only the MCP subset of the target file', () => {
  it('never shows credentials or account data of .claude.json', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    await writeFile(join(home, '.claude.json'), JSON.stringify(claudeJson, null, 2));

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts: [account('claude', home)],
      library,
    });

    const item = preview.items[0];
    expect(item?.status).toBe('update');
    for (const text of PRIVATE_TEXT) {
      expect(item?.maskedBefore).not.toContain(text);
      expect(item?.maskedAfter).not.toContain(text);
    }
    expect(JSON.parse(item?.maskedBefore ?? '')).toEqual({
      mcpServers: { mine: { command: 'mine', env: { TOKEN: '***' } } },
    });
    expect(JSON.parse(item?.maskedAfter ?? '')).toEqual({
      mcpServers: {
        mine: { command: 'mine', env: { TOKEN: '***' } },
        docs: { command: 'run-docs' },
      },
    });
  });

  it('shows the opencode mcp key only', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    await writeFile(
      join(project, 'opencode.json'),
      JSON.stringify({ provider: { openai: { apiKey: 'sk-open-REALSECRET' } }, mcp: {} }),
    );

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts: [account('opencode', home)],
      library,
    });

    expect(preview.items[0]?.maskedBefore).not.toContain('REALSECRET');
    expect(JSON.parse(preview.items[0]?.maskedAfter ?? '')).toEqual({
      mcp: { docs: { command: 'run-docs' } },
    });
  });

  it('shows only the masked mcp_servers tables of codex, also when the file cannot be read', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const toml = [
      'openai_api_key = "sk-REALSECRET"',
      '',
      '[profiles.work]',
      'token = "profile-REALSECRET"',
      '',
      '[mcp_servers.github]',
      'command = "gh"',
      '',
      '[mcp_servers.github.env]',
      'GITHUB_TOKEN = "env-secret-value"',
      '',
    ].join('\n');
    await writeFile(join(home, 'config.toml'), toml);
    const accounts = [account('codex', home)];

    const ok = await previewProfileSync({ root, projectPath: project, accounts, library });
    expect(ok.items[0]?.maskedBefore).toBe(
      '[mcp_servers.github]\ncommand = "gh"\n\n[mcp_servers.github.env]\nGITHUB_TOKEN = "***"',
    );
    expect(ok.items[0]?.maskedAfter).toContain('[mcp_servers.docs]');
    expect(ok.items[0]?.maskedAfter).not.toContain('REALSECRET');

    await writeFile(join(home, 'config.toml'), `${toml}[broken\n`);
    const broken = await previewProfileSync({ root, projectPath: project, accounts, library });
    expect(broken.items[0]?.status).toBe('conflict');
    for (const text of ['REALSECRET', 'env-secret-value']) {
      expect(broken.items[0]?.maskedBefore).not.toContain(text);
      expect(broken.items[0]?.maskedAfter).not.toContain(text);
    }
  });

  it('ends the codex view at a commented non-MCP header after an MCP table', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const toml = [
      '[mcp_servers.github]',
      'command = "gh"',
      '',
      '[profiles.work] # personal',
      'token = "profile-REALSECRET"',
      '',
    ].join('\n');
    await writeFile(join(home, 'config.toml'), toml);

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts: [account('codex', home)],
      library,
    });

    expect(preview.items[0]?.maskedBefore).toBe('[mcp_servers.github]\ncommand = "gh"');
    expect(preview.items[0]?.maskedAfter).not.toContain('REALSECRET');
  });

  it('keeps the legacy full-file preview without a library', async () => {
    const project = await tmp();
    const home = await tmp();
    await writeFile(join(home, '.claude.json'), JSON.stringify(claudeJson, null, 2));
    await writeFile(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { a: { command: 'a' } } }),
    );

    const preview = await previewProfileSync({
      projectPath: project,
      accounts: [account('claude', home)],
    });

    expect(preview.items[0]?.maskedBefore).toContain('oauthAccount');
  });
});
