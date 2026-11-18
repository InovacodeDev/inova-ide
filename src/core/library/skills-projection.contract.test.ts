import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProfileSync,
  previewProfileSync,
  type ProfileSyncAccountInput,
  type ProfileSyncItem,
  type ProfileSyncPreview,
} from '../profile-sync.js';
import { installSkillFromText } from './skills.js';
import type { LibraryItem } from './types.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-skills-projection-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function skillText(id: string): string {
  return `---\nname: ${id}\ndescription: Skill ${id}\n---\n\nBody of ${id}\n`;
}

async function libraryItem(input: {
  root: string;
  id: string;
  enabled?: boolean;
}): Promise<LibraryItem> {
  const { hash } = await installSkillFromText({
    root: input.root,
    id: input.id,
    content: skillText(input.id),
  });
  return {
    id: input.id,
    kind: 'skill',
    name: input.id,
    description: null,
    enabled: input.enabled ?? true,
    source: 'created',
    definition: { hash },
    updatedAt: '2026-11-17T10:00:00.000Z',
  };
}

function account(
  id: string,
  provider: ProfileSyncAccountInput['provider'],
  homeDir: string,
): ProfileSyncAccountInput {
  return { id, provider, label: id, homeDir };
}

function skillItems(preview: ProfileSyncPreview, accountId: string): ProfileSyncItem[] {
  return preview.items.filter((item) => item.scope === 'skill' && item.accountId === accountId);
}

function statusOf(preview: ProfileSyncPreview, accountId: string, skillId: string): string {
  const found = skillItems(preview, accountId).find((item) => item.id.endsWith(`:${skillId}`));
  return found?.status ?? 'absent';
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function syncAll(input: {
  root: string;
  project: string;
  accounts: ProfileSyncAccountInput[];
  items: LibraryItem[];
  approve?: boolean;
}) {
  const library = { items: input.items, projectDisabled: [] };
  const common = {
    root: input.root,
    projectPath: input.project,
    accounts: input.accounts,
    library,
  };
  const preview = await previewProfileSync(common);
  const approvedIds = input.approve ? preview.items.map((item) => item.id) : [];
  const result = await applyProfileSync({ ...common, approvedIds });
  return { preview, result };
}

describe('library skill projection contract', () => {
  it('rule 1: a skill disabled in the library never reaches any provider account', async () => {
    const root = await tmp();
    const project = await tmp();
    const claudeHome = await tmp();
    const codexHome = await tmp();
    const accounts = [account('acc-c', 'claude', claudeHome), account('acc-x', 'codex', codexHome)];
    const items = [
      await libraryItem({ root, id: 'on-skill' }),
      await libraryItem({ root, id: 'off-skill', enabled: false }),
    ];

    await syncAll({ root, project, accounts, items });

    for (const home of [claudeHome, codexHome]) {
      expect(await readFile(join(home, 'skills', 'on-skill', 'SKILL.md'), 'utf8')).toBe(
        skillText('on-skill'),
      );
      expect(await exists(join(home, 'skills', 'off-skill'))).toBe(false);
    }
  });

  it('rule 2: a skill turned off in one account reaches only the other accounts', async () => {
    const root = await tmp();
    const project = await tmp();
    const homeA = await tmp();
    const homeB = await tmp();
    const accounts: ProfileSyncAccountInput[] = [
      account('acc-a', 'claude', homeA),
      {
        ...account('acc-b', 'claude', homeB),
        disabledCapabilities: [{ kind: 'skill', id: 'shared-skill' }],
      },
    ];
    const items = [await libraryItem({ root, id: 'shared-skill' })];

    const { preview } = await syncAll({ root, project, accounts, items });

    expect(await exists(join(homeA, 'skills', 'shared-skill', 'SKILL.md'))).toBe(true);
    expect(await exists(join(homeB, 'skills', 'shared-skill'))).toBe(false);
    expect(statusOf(preview, 'acc-b', 'shared-skill')).toBe('absent');
  });

  it('rule 4: a folder without the IDE marker is never changed or removed', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const accounts = [account('acc-c', 'claude', home)];
    const foreign = join(home, 'skills', 'mine');
    await mkdir(foreign, { recursive: true });
    await writeFile(join(foreign, 'notes.txt'), 'user data');
    const items = [await libraryItem({ root, id: 'mine' })];

    const first = await syncAll({ root, project, accounts, items });
    expect(statusOf(first.preview, 'acc-c', 'mine')).toBe('conflict');
    expect(await readFile(join(foreign, 'notes.txt'), 'utf8')).toBe('user data');
    expect(await exists(join(foreign, 'SKILL.md'))).toBe(false);

    const second = await syncAll({ root, project, accounts, items: [], approve: true });
    expect(statusOf(second.preview, 'acc-c', 'mine')).toBe('absent');
    expect(await readFile(join(foreign, 'notes.txt'), 'utf8')).toBe('user data');
  });

  it('rule 8: removing a library item removes only the marked folder, after approval and backup', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const accounts = [account('acc-c', 'claude', home)];
    const items = [await libraryItem({ root, id: 'gone' })];
    await syncAll({ root, project, accounts, items });
    const foreign = join(home, 'skills', 'user-skill');
    await mkdir(foreign, { recursive: true });
    await writeFile(join(foreign, 'SKILL.md'), 'user content');

    const library = { items: [], projectDisabled: [] };
    const common = { root, projectPath: project, accounts, library };
    const preview = await previewProfileSync(common);
    expect(statusOf(preview, 'acc-c', 'gone')).toBe('remove');
    expect(statusOf(preview, 'acc-c', 'user-skill')).toBe('absent');

    await applyProfileSync({ ...common, approvedIds: [] });
    expect(await exists(join(home, 'skills', 'gone', 'SKILL.md'))).toBe(true);

    const applied = await applyProfileSync({
      ...common,
      approvedIds: preview.items.map((item) => item.id),
    });
    expect(await exists(join(home, 'skills', 'gone'))).toBe(false);
    expect(await readFile(join(foreign, 'SKILL.md'), 'utf8')).toBe('user content');
    expect(applied.appliedIds).toContain('skill:acc-c:gone');
    const backup = join(applied.backupDir, 'skills', 'acc-c', 'gone', 'SKILL.md');
    expect(await readFile(backup, 'utf8')).toBe(skillText('gone'));
  });

  it('rule 9: a conflict is not overwritten without approval and is backed up when approved', async () => {
    const root = await tmp();
    const project = await tmp();
    const home = await tmp();
    const accounts = [account('acc-c', 'claude', home)];
    const foreign = join(home, 'skills', 'clash');
    await mkdir(foreign, { recursive: true });
    await writeFile(join(foreign, 'SKILL.md'), 'user version');
    const items = [await libraryItem({ root, id: 'clash' })];

    const denied = await syncAll({ root, project, accounts, items });
    expect(statusOf(denied.preview, 'acc-c', 'clash')).toBe('conflict');
    expect(denied.result.skippedIds).toContain('skill:acc-c:clash');
    expect(await readFile(join(foreign, 'SKILL.md'), 'utf8')).toBe('user version');

    const approved = await syncAll({ root, project, accounts, items, approve: true });
    expect(approved.result.appliedIds).toContain('skill:acc-c:clash');
    expect(await readFile(join(foreign, 'SKILL.md'), 'utf8')).toBe(skillText('clash'));
    const backup = join(approved.result.backupDir, 'skills', 'acc-c', 'clash', 'SKILL.md');
    expect(await readFile(backup, 'utf8')).toBe('user version');
  });

  it('rule 7: providers without skill support report a reason while other accounts still sync', async () => {
    const root = await tmp();
    const project = await tmp();
    const claudeHome = await tmp();
    const accounts = [
      account('acc-c', 'claude', claudeHome),
      account('acc-d', 'deepseek', await tmp()),
      account('acc-g', 'gemini', await tmp()),
    ];
    const items = [await libraryItem({ root, id: 'portable' })];

    const { preview, result } = await syncAll({ root, project, accounts, items });

    expect(statusOf(preview, 'acc-c', 'portable')).toBe('create');
    for (const accountId of ['acc-d', 'acc-g']) {
      const [only] = skillItems(preview, accountId);
      expect(skillItems(preview, accountId)).toHaveLength(1);
      expect(only?.status).toBe('incompatible');
      expect(only?.reason ?? '').not.toBe('');
      expect(result.skippedIds).toContain(only?.id);
    }
    expect(await exists(join(claudeHome, 'skills', 'portable', 'SKILL.md'))).toBe(true);
    expect(await readdir(join(claudeHome, 'skills'))).toEqual(['portable']);
  });
});
