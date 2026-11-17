import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-mcp-removal-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function mcpItem(id: string, enabled = true): LibraryItem {
  return {
    id,
    kind: 'mcp',
    name: id,
    description: null,
    enabled,
    source: 'created',
    definition: { command: `run-${id}` },
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

async function applyAll(input: {
  root: string;
  projectPath: string;
  accounts: ProfileSyncAccountInput[];
  library: ProfileSyncLibraryInput;
}) {
  const preview = await previewProfileSync(input);
  return applyProfileSync({ ...input, approvedIds: preview.items.map((item) => item.id) });
}

describe('removal of library MCP projections contract', () => {
  it('rule 1: an item disabled in the library is removed from every account that received it', async () => {
    const root = await tmp();
    const project = await tmp();
    const claudeHome = await tmp();
    const qwenHome = await tmp();
    const codexHome = await tmp();
    const accounts = [
      account('claude', claudeHome),
      account('qwen', qwenHome),
      account('codex', codexHome),
    ];
    await applyAll({ root, projectPath: project, accounts, library: libraryOf([mcpItem('docs')]) });
    const disabled = libraryOf([mcpItem('docs', false)]);

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts,
      library: disabled,
    });
    for (const item of preview.items) {
      expect(item.status).toBe('update');
      expect(item.reason).toContain('Remove MCP gerenciado: docs.');
    }
    await applyAll({ root, projectPath: project, accounts, library: disabled });

    expect(await jsonServers(join(claudeHome, '.claude.json'))).toEqual({});
    expect(await jsonServers(join(qwenHome, '.qwen', 'settings.json'))).toEqual({});
    expect(await readFile(join(codexHome, 'config.toml'), 'utf8')).not.toContain('docs');
  });

  it('rule 8: removing an item removes only its marked projection, and only after approval', async () => {
    const root = await tmp();
    const project = await tmp();
    const homeA = await tmp();
    const homeB = await tmp();
    const targetA = join(homeA, '.claude.json');
    const targetB = join(homeB, '.claude.json');
    await writeFile(targetA, JSON.stringify({ mcpServers: { mine: { command: 'mine' } } }));
    await writeFile(targetB, JSON.stringify({ mcpServers: { docs: { command: 'run-docs' } } }));
    const accounts = [
      { ...account('claude', homeA), id: 'acc-a' },
      { ...account('claude', homeB), id: 'acc-b' },
    ];
    await applyAll({ root, projectPath: project, accounts, library: libraryOf([mcpItem('docs')]) });
    expect((await loadManaged(root)).mcp).toEqual({ [targetA]: ['docs'] });
    const removed = libraryOf([]);
    const common = { root, projectPath: project, accounts, library: removed };

    const preview = await previewProfileSync(common);
    const itemA = preview.items.find((item) => item.id === 'mcp:acc-a');
    expect(itemA).toMatchObject({ status: 'update', reason: 'Remove MCP gerenciado: docs.' });
    expect(preview.items.find((item) => item.id === 'mcp:acc-b')?.status).toBe('unchanged');

    const refused = await applyProfileSync({ ...common, approvals: 'key', approvedIds: [] });
    expect(refused.skippedIds).toContain('mcp:acc-a');
    expect(Object.keys(await jsonServers(targetA)).sort()).toEqual(['docs', 'mine']);

    const beforeRemoval = await readFile(targetA, 'utf8');
    const applied = await applyProfileSync({
      ...common,
      approvals: 'key',
      approvedIds: [itemA?.approvalKey ?? ''],
    });
    expect(applied.appliedIds).toEqual(['mcp:acc-a']);
    expect(await jsonServers(targetA)).toEqual({ mine: { command: 'mine' } });
    expect(await jsonServers(targetB)).toEqual({ docs: { command: 'run-docs' } });
    const backups = await readdir(applied.backupDir);
    expect(backups).toHaveLength(1);
    expect(await readFile(join(applied.backupDir, backups[0] ?? ''), 'utf8')).toBe(beforeRemoval);
    expect((await loadManaged(root)).mcp[targetA]).toEqual([]);
  });

  it('rule 4: a server without the marker of that target is never removed', async () => {
    const root = await tmp();
    const project = await tmp();
    const claudeHome = await tmp();
    const qwenHome = await tmp();
    const accounts = [account('claude', claudeHome)];
    await applyAll({ root, projectPath: project, accounts, library: libraryOf([mcpItem('docs')]) });
    const qwenTarget = join(qwenHome, '.qwen', 'settings.json');
    await mkdir(join(qwenHome, '.qwen'), { recursive: true });
    const userOwn = `${JSON.stringify({ mcpServers: { docs: { command: 'mine' }, other: { command: 'o' } } }, null, 2)}\n`;
    await writeFile(qwenTarget, userOwn);
    const both = [...accounts, account('qwen', qwenHome)];

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts: both,
      library: libraryOf([]),
    });
    expect(preview.items.find((item) => item.id === 'mcp:acc-qwen')?.status).toBe('unchanged');
    await applyAll({ root, projectPath: project, accounts: both, library: libraryOf([]) });

    expect(await readFile(qwenTarget, 'utf8')).toBe(userOwn);
    expect(await jsonServers(join(claudeHome, '.claude.json'))).toEqual({});
  });

  it('rule 2: disabling on the account removes; disabling only on the project removes only from opencode', async () => {
    const root = await tmp();
    const project = await tmp();
    const claudeHome = await tmp();
    const codexHome = await tmp();
    const opencodeHome = await tmp();
    const accounts = [
      account('claude', claudeHome),
      account('codex', codexHome),
      account('opencode', opencodeHome),
    ];
    const items = [mcpItem('docs'), mcpItem('keep')];
    await applyAll({ root, projectPath: project, accounts, library: libraryOf(items) });

    await applyAll({ root, projectPath: project, accounts, library: libraryOf(items, ['docs']) });
    expect(Object.keys(await jsonServers(join(claudeHome, '.claude.json'))).sort()).toEqual([
      'docs',
      'keep',
    ]);
    expect(await readFile(join(codexHome, 'config.toml'), 'utf8')).toContain('[mcp_servers.docs]');
    expect(Object.keys(await jsonServers(join(project, 'opencode.json'), 'mcp'))).toEqual(['keep']);

    const accountOff = accounts.map((entry) =>
      entry.provider === 'opencode'
        ? entry
        : { ...entry, disabledCapabilities: [{ kind: 'mcp' as const, id: 'docs' }] },
    );
    await applyAll({ root, projectPath: project, accounts: accountOff, library: libraryOf(items) });
    expect(Object.keys(await jsonServers(join(claudeHome, '.claude.json')))).toEqual(['keep']);
    const toml = await readFile(join(codexHome, 'config.toml'), 'utf8');
    expect(toml).not.toContain('docs');
    expect(toml).toContain('[mcp_servers.keep]');
  });
});
