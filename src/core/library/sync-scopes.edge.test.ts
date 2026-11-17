import { mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProfileSync,
  previewProfileSync,
  type ProfileSyncAccountInput,
  type ProfileSyncLibraryInput,
  type ProfileSyncScope,
} from '../profile-sync.js';
import { installSkillFromText } from './skills.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-sync-scopes-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function scene() {
  const root = await tmp();
  const projectPath = await tmp();
  const homeDir = await tmp();
  await writeFile(join(projectPath, 'AGENTS.md'), '# rules\n');
  const { hash } = await installSkillFromText({
    root,
    id: 'demo-skill',
    content: '---\nname: demo\ndescription: Demo skill\n---\n\nBody\n',
  });
  const library: ProfileSyncLibraryInput = {
    projectDisabled: [],
    items: [
      {
        id: 'demo-skill',
        kind: 'skill',
        name: 'Demo',
        description: null,
        enabled: true,
        source: 'created',
        definition: { hash },
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
      {
        id: 'demo-mcp',
        kind: 'mcp',
        name: 'Demo MCP',
        description: null,
        enabled: true,
        source: 'created',
        definition: { command: 'npx', args: ['demo'] },
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
    ],
  };
  const accounts: ProfileSyncAccountInput[] = [
    { id: 'acc-claude', provider: 'claude', label: 'Claude', homeDir },
  ];
  return { root, projectPath, homeDir, library, accounts };
}

function scopesOf(items: readonly { scope: string }[]): string[] {
  return [...new Set(items.map((item) => item.scope))].sort();
}

describe('profile-sync scopes', () => {
  it('plans every scope when scopes is omitted', async () => {
    const { root, projectPath, library, accounts } = await scene();
    const preview = await previewProfileSync({ root, projectPath, accounts, library });
    expect(scopesOf(preview.items)).toEqual(['mcp', 'rules', 'skill']);
  });

  it.each<[ProfileSyncScope[], string[]]>([
    [
      ['mcp', 'skill'],
      ['mcp', 'skill'],
    ],
    [['skill'], ['skill']],
    [['mcp'], ['mcp']],
    [['rules'], ['rules']],
    [[], []],
  ])('previews only %j items', async (scopes, expected) => {
    const { root, projectPath, library, accounts } = await scene();
    const preview = await previewProfileSync({ root, projectPath, accounts, library, scopes });
    expect(scopesOf(preview.items)).toEqual(expected);
  });

  it('never creates rules files when rules is outside the scopes', async () => {
    const { root, projectPath, homeDir, library, accounts } = await scene();
    const result = await applyProfileSync({
      root,
      projectPath,
      accounts,
      library,
      scopes: ['mcp', 'skill'],
      approvedIds: [],
    });
    expect(await exists(join(projectPath, 'CLAUDE.md'))).toBe(false);
    expect(result.appliedIds).not.toContain('rules:CLAUDE.md');
    expect(await exists(join(homeDir, 'skills', 'demo-skill', 'SKILL.md'))).toBe(true);
    expect(await exists(join(homeDir, '.claude.json'))).toBe(true);
  });

  it('creates the rules file when scopes is omitted, as before', async () => {
    const { root, projectPath, library, accounts } = await scene();
    await applyProfileSync({ root, projectPath, accounts, library, approvedIds: [] });
    expect(await exists(join(projectPath, 'CLAUDE.md'))).toBe(true);
  });

  it('writes nothing when scopes is empty', async () => {
    const { root, projectPath, homeDir, library, accounts } = await scene();
    const result = await applyProfileSync({
      root,
      projectPath,
      accounts,
      library,
      scopes: [],
      approvedIds: [],
    });
    expect(result.appliedIds).toEqual([]);
    expect(await readdir(homeDir)).toEqual([]);
    expect(await exists(join(projectPath, 'CLAUDE.md'))).toBe(false);
  });
});
