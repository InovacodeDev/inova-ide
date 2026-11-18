import type * as FsPromises from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyProfileSync,
  previewProfileSync,
  type ProfileSyncAccountInput,
} from '../profile-sync.js';
import { installSkillFromText } from './skills.js';
import type { LibraryItem } from './types.js';

const denied = vi.hoisted(() => new Set<string>());

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const refuse = (syscall: string): Promise<never> =>
    Promise.reject(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES', syscall }),
    );
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) =>
      denied.has(String(args[0])) ? refuse('open') : actual.readFile(...args),
    lstat: (...args: Parameters<typeof actual.lstat>) =>
      denied.has(String(args[0])) ? refuse('lstat') : actual.lstat(...args),
  };
});

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-unreadable-')));
  dirs.push(dir);
  return dir;
}

function lock(path: string): void {
  denied.add(path);
}

afterEach(async () => {
  denied.clear();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const UPDATED_AT = '2026-11-17T10:00:00.000Z';

function mcpItem(id: string): LibraryItem {
  return {
    id,
    kind: 'mcp',
    name: id,
    description: null,
    enabled: true,
    source: 'created',
    definition: { command: `run-${id}` },
    updatedAt: UPDATED_AT,
  };
}

function account(
  provider: ProfileSyncAccountInput['provider'],
  homeDir: string,
): ProfileSyncAccountInput {
  return { id: `acc-${provider}`, provider, label: provider, homeDir };
}

describe('an unreadable MCP file of one account does not stop the others', () => {
  it('turns an invalid qwen settings.json into a conflict with a generic reason', async () => {
    const root = await tmp();
    const project = await tmp();
    const claudeHome = await tmp();
    const qwenHome = await tmp();
    const corrupt = '{ not json, "primaryApiKey": "sk-secret"';
    await mkdir(join(qwenHome, '.qwen'), { recursive: true });
    await writeFile(join(qwenHome, '.qwen', 'settings.json'), corrupt);
    const accounts = [account('claude', claudeHome), account('qwen', qwenHome)];
    const library = { items: [mcpItem('docs')], projectDisabled: [] };

    const preview = await previewProfileSync({ root, projectPath: project, accounts, library });

    expect(preview.items.find((item) => item.id === 'mcp:acc-claude')?.status).toBe('create');
    const qwen = preview.items.find((item) => item.id === 'mcp:acc-qwen');
    expect(qwen).toMatchObject({
      status: 'conflict',
      reason: 'Arquivo de configuração ilegível: settings.json. Corrija ou restaure o arquivo.',
      maskedBefore: '',
      maskedAfter: '',
    });
    expect(JSON.stringify(qwen)).not.toContain('sk-secret');

    const applied = await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      library,
      approvedIds: preview.items.map((item) => item.id),
    });
    expect(applied.appliedIds).toEqual(['mcp:acc-claude']);
    expect(applied.skippedIds).toEqual(['mcp:acc-qwen']);
    expect(await readFile(join(qwenHome, '.qwen', 'settings.json'), 'utf8')).toBe(corrupt);
  });

  it('turns an unreadable codex config.toml into a conflict', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    await writeFile(join(home, 'config.toml'), '[mcp_servers.x]\ncommand = "x"\n');
    lock(join(home, 'config.toml'));

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts: [account('codex', home)],
      library: { items: [mcpItem('docs')], projectDisabled: [] },
    });

    expect(preview.items[0]).toMatchObject({
      status: 'conflict',
      reason: 'Arquivo de configuração ilegível: config.toml. Corrija ou restaure o arquivo.',
    });
  });

  it('keeps throwing without a library', async () => {
    const project = await tmp();
    const qwenHome = await tmp();
    await mkdir(join(qwenHome, '.qwen'), { recursive: true });
    await writeFile(join(qwenHome, '.qwen', 'settings.json'), '{ not json');
    await writeFile(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { a: { command: 'a' } } }),
    );

    await expect(
      previewProfileSync({ projectPath: project, accounts: [account('qwen', qwenHome)] }),
    ).rejects.toThrow(/JSON inválido/);
  });
});

describe('an unreadable skills folder of one account does not stop the others', () => {
  it('reports that account as incompatible and plans the others', async () => {
    const root = await tmp();
    const project = await tmp();
    const blockedHome = await tmp();
    const okHome = await tmp();
    const content = '---\nname: s\ndescription: d\n---\nbody\n';
    const { hash } = await installSkillFromText({ root, id: 's', content });
    const skill: LibraryItem = {
      id: 's',
      kind: 'skill',
      name: 's',
      description: null,
      enabled: true,
      source: 'created',
      definition: { hash },
      updatedAt: UPDATED_AT,
    };
    await mkdir(join(blockedHome, 'skills'));
    lock(join(blockedHome, 'skills'));
    const accounts = [
      { ...account('claude', blockedHome), id: 'blocked' },
      { ...account('claude', okHome), id: 'ok' },
    ];

    const preview = await previewProfileSync({
      root,
      projectPath: project,
      accounts,
      library: { items: [skill], projectDisabled: [] },
      scopes: ['skill'],
    });

    expect(preview.items.find((item) => item.id === 'skill:blocked')).toMatchObject({
      status: 'incompatible',
      reason: 'Não foi possível ler as skills desta conta. Corrija as permissões e tente de novo.',
    });
    expect(preview.items.find((item) => item.id === 'skill:ok:s')?.status).toBe('create');
  });
});
