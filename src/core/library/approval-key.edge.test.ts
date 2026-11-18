import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProfileSync,
  previewProfileSync,
  type ProfileSyncAccountInput,
  type ProfileSyncLibraryInput,
} from '../profile-sync.js';
import { installSkillFromText } from './skills.js';
import type { LibraryItem } from './types.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-approval-key-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
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

async function skillItem(input: { root: string; body: string; enabled?: boolean }) {
  const content = `---\nname: s\ndescription: d\n---\n${input.body}\n`;
  const { hash } = await installSkillFromText({ root: input.root, id: 's', content });
  const item: LibraryItem = {
    id: 's',
    kind: 'skill',
    name: 's',
    description: null,
    enabled: input.enabled ?? true,
    source: 'created',
    definition: { hash },
    updatedAt: UPDATED_AT,
  };
  return item;
}

function claude(homeDir: string): ProfileSyncAccountInput[] {
  return [{ id: 'acc', provider: 'claude', label: 'claude', homeDir }];
}

async function mcpSetup() {
  const root = await tmp();
  const project = await tmp();
  const home = await tmp();
  const target = join(home, '.claude.json');
  await writeFile(target, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
  const library: ProfileSyncLibraryInput = { items: [mcpItem('lib-one')], projectDisabled: [] };
  const common = { root, projectPath: project, accounts: claude(home), library };
  const preview = await previewProfileSync(common);
  const item = preview.items.find((entry) => entry.id === 'mcp:acc');
  expect(item?.status).toBe('update');
  return { common, target, key: item?.approvalKey ?? '' };
}

describe('approval by key is bound to the previewed state', () => {
  it('gives every item a 32 hex approval key that changes with the target MCP content', async () => {
    const { common, target, key } = await mcpSetup();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    await writeFile(target, JSON.stringify({ mcpServers: { other: { command: 'other' } } }));
    const again = await previewProfileSync(common);
    expect(again.items[0]?.approvalKey).not.toBe(key);
  });

  it('applies an MCP update when the key matches and refuses the bare id', async () => {
    const { common, target, key } = await mcpSetup();

    const byId = await applyProfileSync({ ...common, approvals: 'key', approvedIds: ['mcp:acc'] });
    expect(byId.skippedIds).toEqual(['mcp:acc']);
    expect(await readFile(target, 'utf8')).not.toContain('lib-one');

    const byKey = await applyProfileSync({ ...common, approvals: 'key', approvedIds: [key] });
    expect(byKey.appliedIds).toEqual(['mcp:acc']);
    expect(await readFile(target, 'utf8')).toContain('lib-one');
  });

  it('skips an approved MCP update that became a conflict before apply', async () => {
    const { common, target, key } = await mcpSetup();
    const userOwn = JSON.stringify({ mcpServers: { 'lib-one': { command: 'mine' } } });
    await writeFile(target, userOwn);
    expect((await previewProfileSync(common)).items[0]?.status).toBe('conflict');

    const result = await applyProfileSync({ ...common, approvals: 'key', approvedIds: [key] });

    expect(result.skippedIds).toEqual(['mcp:acc']);
    expect(await readFile(target, 'utf8')).toBe(userOwn);
  });

  it('skips an approved MCP update whose target changed but stayed an update', async () => {
    const { common, target, key } = await mcpSetup();
    const changed = JSON.stringify({ mcpServers: { other: { command: 'other' } } });
    await writeFile(target, changed);
    expect((await previewProfileSync(common)).items[0]?.status).toBe('update');

    const result = await applyProfileSync({ ...common, approvals: 'key', approvedIds: [key] });

    expect(result.skippedIds).toEqual(['mcp:acc']);
    expect(await readFile(target, 'utf8')).toBe(changed);
  });
});

describe('approval by key for skills', () => {
  async function skillSetup() {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const v1 = await skillItem({ root, body: 'v1' });
    const base = { root, projectPath: project, accounts: claude(home), scopes: ['skill'] as const };
    await applyProfileSync({
      ...base,
      library: { items: [v1], projectDisabled: [] },
      approvedIds: [],
    });
    const v2 = await skillItem({ root, body: 'v2' });
    const library = { items: [v2], projectDisabled: [] };
    const preview = await previewProfileSync({ ...base, library });
    const item = preview.items.find((entry) => entry.id === 'skill:acc:s');
    expect(item?.status).toBe('update');
    return { base, library, v2, target: join(home, 'skills', 's'), key: item?.approvalKey ?? '' };
  }

  it('skips an approved skill update that became a foreign folder', async () => {
    const { base, library, target, key } = await skillSetup();
    await rm(target, { recursive: true });
    await mkdir(target);
    await writeFile(join(target, 'SKILL.md'), 'USER OWN SKILL');

    const result = await applyProfileSync({
      ...base,
      library,
      approvals: 'key',
      approvedIds: [key],
    });

    expect(result.skippedIds).toEqual(['skill:acc:s']);
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('USER OWN SKILL');
  });

  it('skips an approved skill update that became a removal', async () => {
    const { base, v2, target, key } = await skillSetup();
    const disabled = { items: [{ ...v2, enabled: false }], projectDisabled: [] };
    expect(
      (await previewProfileSync({ ...base, library: disabled })).items.find(
        (entry) => entry.id === 'skill:acc:s',
      )?.status,
    ).toBe('remove');

    const result = await applyProfileSync({
      ...base,
      library: disabled,
      approvals: 'key',
      approvedIds: [key],
    });

    expect(result.skippedIds).toEqual(['skill:acc:s']);
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toContain('v1');
  });

  it('applies the skill update when the key matches', async () => {
    const { base, library, target, key } = await skillSetup();

    const result = await applyProfileSync({
      ...base,
      library,
      approvals: 'key',
      approvedIds: [key],
    });

    expect(result.appliedIds).toEqual(['skill:acc:s']);
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toContain('v2');
  });
});
