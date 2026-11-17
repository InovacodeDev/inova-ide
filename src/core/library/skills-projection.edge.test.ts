import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyProfileSync,
  previewProfileSync,
  type ProfileSyncAccountInput,
  type ProfileSyncItem,
  type ProfileSyncPreview,
} from '../profile-sync.js';
import { applySkillEntry, planSkillTargets } from './skills-projection.js';
import { installSkillFromText } from './skills.js';
import { skillDir } from './store.js';
import type { LibraryItem } from './types.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-skills-proj-edge-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function skillText(id: string, version = 'v1'): string {
  return `---\nname: ${id}\ndescription: Skill ${id}\n---\n\nBody ${id} ${version}\n`;
}

async function libraryItem(input: {
  root: string;
  id: string;
  version?: string;
  enabled?: boolean;
}): Promise<LibraryItem> {
  const { hash } = await installSkillFromText({
    root: input.root,
    id: input.id,
    content: skillText(input.id, input.version),
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

function itemOf(preview: ProfileSyncPreview, accountId: string, skillId: string) {
  return skillItems(preview, accountId).find((item) => item.id === `skill:${accountId}:${skillId}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readMarkerFile(home: string, id: string): Promise<unknown> {
  return JSON.parse(await readFile(join(home, 'skills', id, '.inova-managed'), 'utf8'));
}

async function tempLeftovers(home: string): Promise<string[]> {
  try {
    return (await readdir(join(home, 'skills'))).filter((name) => name.startsWith('.tmp-'));
  } catch {
    return [];
  }
}

interface Setup {
  root: string;
  project: string;
  accounts: ProfileSyncAccountInput[];
}

function inputsFor(setup: Setup, items: LibraryItem[], projectDisabled: string[] = []) {
  return {
    root: setup.root,
    projectPath: setup.project,
    accounts: setup.accounts,
    library: { items, projectDisabled },
  };
}

async function claudeSetup(): Promise<Setup & { home: string }> {
  const home = await tmp();
  return {
    root: await tmp(),
    project: await tmp(),
    accounts: [account('acc', 'claude', home)],
    home,
  };
}

async function applyAll(input: ReturnType<typeof inputsFor>) {
  const preview = await previewProfileSync(input);
  const approvedIds = preview.items.map((item) => item.id);
  return applyProfileSync({ ...input, approvedIds });
}

describe('marker validation', () => {
  it.each([
    ['invalid JSON', '{not json'],
    ['another id', '{"managedBy":"inova-ide","id":"other","hash":"abc"}'],
    ['another owner', '{"managedBy":"someone","id":"s","hash":"abc"}'],
    ['a missing hash', '{"managedBy":"inova-ide","id":"s"}'],
    ['a JSON array', '[]'],
    ['an oversized body', `{"managedBy":"inova-ide","id":"s","hash":"${'a'.repeat(5000)}"}`],
  ])('treats a marker with %s as a conflict and leaves the folder alone', async (_label, body) => {
    const setup = await claudeSetup();
    const folder = join(setup.home, 'skills', 's');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, '.inova-managed'), body);
    await writeFile(join(folder, 'mine.txt'), 'mine');
    const items = [await libraryItem({ root: setup.root, id: 's' })];

    const preview = await previewProfileSync(inputsFor(setup, items));
    expect(itemOf(preview, 'acc', 's')?.status).toBe('conflict');
    await applyProfileSync({ ...inputsFor(setup, items), approvedIds: [] });
    expect(await readFile(join(folder, 'mine.txt'), 'utf8')).toBe('mine');
    expect(await readFile(join(folder, '.inova-managed'), 'utf8')).toBe(body);
  });

  it('treats a marker that is a symbolic link as no marker', async () => {
    const setup = await claudeSetup();
    const folder = join(setup.home, 'skills', 's');
    await mkdir(folder, { recursive: true });
    const real = join(setup.project, 'real-marker');
    await writeFile(real, `{"managedBy":"inova-ide","id":"s","hash":"abc"}`);
    try {
      await symlink(real, join(folder, '.inova-managed'), 'file');
    } catch {
      return;
    }
    const items = [await libraryItem({ root: setup.root, id: 's' })];
    const preview = await previewProfileSync(inputsFor(setup, items));
    expect(itemOf(preview, 'acc', 's')?.status).toBe('conflict');
  });

  it('never creates a remove item for a forged marker of a removed library item', async () => {
    const setup = await claudeSetup();
    const folder = join(setup.home, 'skills', 'forged');
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, '.inova-managed'),
      '{"managedBy":"inova-ide","id":"another","hash":"abc"}',
    );
    const preview = await previewProfileSync(inputsFor(setup, []));
    expect(skillItems(preview, 'acc')).toEqual([]);
  });
});

describe('status decisions', () => {
  it('reports update when the marker hash is older than the library hash, and applies it', async () => {
    const setup = await claudeSetup();
    const first = [await libraryItem({ root: setup.root, id: 's', version: 'v1' })];
    await applyAll(inputsFor(setup, first));
    const second = [await libraryItem({ root: setup.root, id: 's', version: 'v2' })];

    const preview = await previewProfileSync(inputsFor(setup, second));
    expect(itemOf(preview, 'acc', 's')?.status).toBe('update');

    const denied = await applyProfileSync({ ...inputsFor(setup, second), approvedIds: [] });
    expect(denied.skippedIds).toContain('skill:acc:s');
    expect(await readFile(join(setup.home, 'skills', 's', 'SKILL.md'), 'utf8')).toBe(
      skillText('s', 'v1'),
    );

    const applied = await applyProfileSync({
      ...inputsFor(setup, second),
      approvedIds: ['skill:acc:s'],
    });
    expect(await readFile(join(setup.home, 'skills', 's', 'SKILL.md'), 'utf8')).toBe(
      skillText('s', 'v2'),
    );
    expect(await readMarkerFile(setup.home, 's')).toEqual({
      managedBy: 'inova-ide',
      id: 's',
      hash: (second[0] as { definition: { hash: string } }).definition.hash,
    });
    const backup = join(applied.backupDir, 'skills', 'acc', 's', 'SKILL.md');
    expect(await readFile(backup, 'utf8')).toBe(skillText('s', 'v1'));
    expect(await tempLeftovers(setup.home)).toEqual([]);
  });

  it('decides by the library hash against the marker, so a hand edit in the account stays unchanged', async () => {
    const setup = await claudeSetup();
    const items = [await libraryItem({ root: setup.root, id: 's' })];
    await applyAll(inputsFor(setup, items));
    await writeFile(join(setup.home, 'skills', 's', 'SKILL.md'), 'edited by hand');

    const preview = await previewProfileSync(inputsFor(setup, items));
    expect(itemOf(preview, 'acc', 's')?.status).toBe('unchanged');
  });

  it('recomputes the library hash instead of trusting the hash stored in the item', async () => {
    const setup = await claudeSetup();
    const [item] = [await libraryItem({ root: setup.root, id: 's', version: 'v1' })];
    await applyAll(inputsFor(setup, [item as LibraryItem]));
    await writeFile(join(skillDir(setup.root, 's'), 'SKILL.md'), skillText('s', 'v2'));

    const preview = await previewProfileSync(inputsFor(setup, [item as LibraryItem]));
    expect(itemOf(preview, 'acc', 's')?.status).toBe('update');
  });

  it('reports incompatible when the library folder is missing or has no SKILL.md', async () => {
    const setup = await claudeSetup();
    const present = await libraryItem({ root: setup.root, id: 'present' });
    const ghost: LibraryItem = { ...present, id: 'ghost', name: 'ghost' };
    const hollow: LibraryItem = { ...present, id: 'hollow', name: 'hollow' };
    await mkdir(skillDir(setup.root, 'hollow'), { recursive: true });
    await writeFile(join(skillDir(setup.root, 'hollow'), 'readme.txt'), 'x');

    const preview = await previewProfileSync(inputsFor(setup, [present, ghost, hollow]));
    expect(itemOf(preview, 'acc', 'ghost')?.status).toBe('incompatible');
    expect(itemOf(preview, 'acc', 'hollow')?.status).toBe('incompatible');
    expect(itemOf(preview, 'acc', 'ghost')?.reason).toContain('biblioteca');
    expect(itemOf(preview, 'acc', 'present')?.status).toBe('create');
  });

  it('reports incompatible when the library folder holds a symbolic link', async () => {
    const setup = await claudeSetup();
    const item = await libraryItem({ root: setup.root, id: 's' });
    try {
      await symlink(setup.project, join(skillDir(setup.root, 's'), 'out'), 'junction');
    } catch {
      return;
    }
    const preview = await previewProfileSync(inputsFor(setup, [item]));
    expect(itemOf(preview, 'acc', 's')?.status).toBe('incompatible');
  });

  it('never copies an environment file found in the library folder', async () => {
    const setup = await claudeSetup();
    const item = await libraryItem({ root: setup.root, id: 's' });
    await writeFile(join(skillDir(setup.root, 's'), '.env'), 'TOKEN=abc');

    await applyAll(inputsFor(setup, [item]));

    expect(await exists(join(setup.home, 'skills', 's', 'SKILL.md'))).toBe(true);
    expect(await exists(join(setup.home, 'skills', 's', '.env'))).toBe(false);
  });
});

describe('unsafe targets', () => {
  it('reports a conflict and writes nothing when the account skills folder is a symbolic link', async () => {
    const setup = await claudeSetup();
    const outside = await tmp();
    try {
      await symlink(outside, join(setup.home, 'skills'), 'junction');
    } catch {
      return;
    }
    const items = [await libraryItem({ root: setup.root, id: 's' })];
    const input = inputsFor(setup, items);
    const preview = await previewProfileSync(input);
    expect(itemOf(preview, 'acc', 's')?.status).toBe('conflict');

    const applied = await applyProfileSync({ ...input, approvedIds: ['skill:acc:s'] });
    expect(applied.skippedIds).toContain('skill:acc:s');
    expect(await readdir(outside)).toEqual([]);
  });

  it('reports a conflict when a plain file has the skill name, and backs it up when approved', async () => {
    const setup = await claudeSetup();
    await mkdir(join(setup.home, 'skills'), { recursive: true });
    await writeFile(join(setup.home, 'skills', 's'), 'plain file');
    const items = [await libraryItem({ root: setup.root, id: 's' })];
    const input = inputsFor(setup, items);

    expect(itemOf(await previewProfileSync(input), 'acc', 's')?.status).toBe('conflict');
    await applyProfileSync({ ...input, approvedIds: [] });
    expect(await readFile(join(setup.home, 'skills', 's'), 'utf8')).toBe('plain file');

    const applied = await applyProfileSync({ ...input, approvedIds: ['skill:acc:s'] });
    expect(await exists(join(setup.home, 'skills', 's', 'SKILL.md'))).toBe(true);
    expect(await readFile(join(applied.backupDir, 'skills', 'acc', 's'), 'utf8')).toBe(
      'plain file',
    );
  });

  it('reports a conflict when the skill folder is a symbolic link and keeps the link target intact', async () => {
    const setup = await claudeSetup();
    const outside = await tmp();
    await writeFile(join(outside, 'keep.txt'), 'keep');
    await mkdir(join(setup.home, 'skills'), { recursive: true });
    try {
      await symlink(outside, join(setup.home, 'skills', 's'), 'junction');
    } catch {
      return;
    }
    const items = [await libraryItem({ root: setup.root, id: 's' })];
    const input = inputsFor(setup, items);
    expect(itemOf(await previewProfileSync(input), 'acc', 's')?.status).toBe('conflict');

    await applyProfileSync({ ...input, approvedIds: ['skill:acc:s'] });
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    expect(await exists(join(outside, 'SKILL.md'))).toBe(false);
  });

  it('never removes a symbolic link or a plain file that borrows a marked name', async () => {
    const setup = await claudeSetup();
    const elsewhere = await tmp();
    await writeFile(
      join(elsewhere, '.inova-managed'),
      '{"managedBy":"inova-ide","id":"linked","hash":"abc"}',
    );
    await mkdir(join(setup.home, 'skills'), { recursive: true });
    await writeFile(join(setup.home, 'skills', 'plain'), 'file');
    try {
      await symlink(elsewhere, join(setup.home, 'skills', 'linked'), 'junction');
    } catch {
      return;
    }
    const preview = await previewProfileSync(inputsFor(setup, []));
    expect(skillItems(preview, 'acc')).toEqual([]);
  });
});

describe('removal', () => {
  it('revalidates the marker at apply time and skips a folder that lost it after planning', async () => {
    const setup = await claudeSetup();
    const items = [await libraryItem({ root: setup.root, id: 's' })];
    await applyAll(inputsFor(setup, items));
    const planned = await planSkillTargets({
      root: setup.root,
      accounts: setup.accounts,
      library: { items: [], projectDisabled: [] },
    });
    const entry = planned.find((candidate) => candidate.item.status === 'remove');
    expect(entry?.item.id).toBe('skill:acc:s');

    await rm(join(setup.home, 'skills', 's', '.inova-managed'));
    const outcome = await applySkillEntry({
      root: setup.root,
      entry: entry!,
      backupDir: join(setup.root, 'backups', 'x'),
      approved: new Set(['skill:acc:s']),
    });

    expect(outcome).toBe('skipped');
    expect(await exists(join(setup.home, 'skills', 's', 'SKILL.md'))).toBe(true);
  });

  it('revalidates before an update and skips a folder that lost its marker after planning', async () => {
    const setup = await claudeSetup();
    await applyAll(inputsFor(setup, [await libraryItem({ root: setup.root, id: 's' })]));
    const second = [await libraryItem({ root: setup.root, id: 's', version: 'v2' })];
    const planned = await planSkillTargets({
      root: setup.root,
      accounts: setup.accounts,
      library: { items: second, projectDisabled: [] },
    });
    const entry = planned.find((candidate) => candidate.item.status === 'update');
    expect(entry).toBeDefined();

    await rm(join(setup.home, 'skills', 's', '.inova-managed'));
    const outcome = await applySkillEntry({
      root: setup.root,
      entry: entry!,
      backupDir: join(setup.root, 'backups', 'x'),
      approved: new Set(['skill:acc:s']),
    });

    expect(outcome).toBe('skipped');
    expect(await readFile(join(setup.home, 'skills', 's', 'SKILL.md'), 'utf8')).toBe(
      skillText('s', 'v1'),
    );
  });

  it('plans a remove for a skill disabled in the library or in the account', async () => {
    const setup = await claudeSetup();
    const items = [
      await libraryItem({ root: setup.root, id: 'by-library' }),
      await libraryItem({ root: setup.root, id: 'by-account' }),
    ];
    await applyAll(inputsFor(setup, items));

    const disabledInLibrary = items.map((item) =>
      item.id === 'by-library' ? { ...item, enabled: false } : item,
    );
    const accounts = [
      {
        ...setup.accounts[0]!,
        disabledCapabilities: [{ kind: 'skill' as const, id: 'by-account' }],
      },
    ];
    const preview = await previewProfileSync({
      ...inputsFor(setup, disabledInLibrary),
      accounts,
    });

    expect(itemOf(preview, 'acc', 'by-library')?.status).toBe('remove');
    expect(itemOf(preview, 'acc', 'by-account')?.status).toBe('remove');
  });

  it('does not plan a remove for a skill turned off only by the project', async () => {
    const setup = await claudeSetup();
    const items = [await libraryItem({ root: setup.root, id: 's' })];
    await applyAll(inputsFor(setup, items));

    const input = inputsFor(setup, items, ['s']);
    const preview = await previewProfileSync(input);
    expect(skillItems(preview, 'acc')).toEqual([]);
    await applyProfileSync({ ...input, approvedIds: ['skill:acc:s'] });
    expect(await exists(join(setup.home, 'skills', 's', 'SKILL.md'))).toBe(true);
  });

  it('removes marked folders of a codex account as well', async () => {
    const root = await tmp();
    const home = await tmp();
    const setup: Setup = { root, project: await tmp(), accounts: [account('cx', 'codex', home)] };
    await applyAll(inputsFor(setup, [await libraryItem({ root, id: 's' })]));
    expect(await exists(join(home, 'skills', 's', 'SKILL.md'))).toBe(true);

    const input = inputsFor(setup, []);
    await applyProfileSync({ ...input, approvedIds: ['skill:cx:s'] });
    expect(await exists(join(home, 'skills', 's'))).toBe(false);
    expect(await tempLeftovers(home)).toEqual([]);
  });
});

describe('failure handling', () => {
  it('leaves no temp folder and reports skipped when the create rename fails, then recovers', async () => {
    const setup = await claudeSetup();
    const items = [await libraryItem({ root: setup.root, id: 's' })];
    const input = inputsFor(setup, items);

    vi.mocked(rename).mockRejectedValueOnce(new Error('rename failed'));
    const failed = await applyProfileSync({ ...input, approvedIds: [] });

    expect(failed.skippedIds).toContain('skill:acc:s');
    expect(failed.appliedIds).not.toContain('skill:acc:s');
    expect(await readdir(join(setup.home, 'skills'))).toEqual([]);

    const retried = await applyProfileSync({ ...input, approvedIds: [] });
    expect(retried.appliedIds).toContain('skill:acc:s');
    expect(await tempLeftovers(setup.home)).toEqual([]);
  });

  it('restores the previous folder when the second rename of an update fails', async () => {
    const setup = await claudeSetup();
    await applyAll(inputsFor(setup, [await libraryItem({ root: setup.root, id: 's' })]));
    const second = [await libraryItem({ root: setup.root, id: 's', version: 'v2' })];
    const actual = await vi.importActual<typeof FsPromises>('node:fs/promises');
    vi.mocked(rename)
      .mockImplementationOnce(actual.rename)
      .mockRejectedValueOnce(new Error('second rename failed'));

    const result = await applyProfileSync({
      ...inputsFor(setup, second),
      approvedIds: ['skill:acc:s'],
    });

    expect(result.skippedIds).toContain('skill:acc:s');
    expect(await readFile(join(setup.home, 'skills', 's', 'SKILL.md'), 'utf8')).toBe(
      skillText('s', 'v1'),
    );
    expect(await readdir(join(setup.home, 'skills'))).toEqual(['s']);
  });

  it('skips the item and leaves no temp folder when the library skill disappears during apply', async () => {
    const setup = await claudeSetup();
    const items = [await libraryItem({ root: setup.root, id: 's' })];
    const planned = await planSkillTargets({
      root: setup.root,
      accounts: setup.accounts,
      library: { items, projectDisabled: [] },
    });
    await rm(skillDir(setup.root, 's'), { recursive: true });

    const outcome = await applySkillEntry({
      root: setup.root,
      entry: planned[0]!,
      backupDir: join(setup.root, 'backups', 'x'),
      approved: new Set(),
    });

    expect(outcome).toBe('skipped');
    expect(await tempLeftovers(setup.home)).toEqual([]);
    expect(await exists(join(setup.home, 'skills', 's'))).toBe(false);
  });
});

describe('scope of the projection', () => {
  it('creates the account skills folder when it does not exist', async () => {
    const setup = await claudeSetup();
    expect(await exists(join(setup.home, 'skills'))).toBe(false);
    await applyAll(inputsFor(setup, [await libraryItem({ root: setup.root, id: 's' })]));
    expect(await exists(join(setup.home, 'skills', 's', 'SKILL.md'))).toBe(true);
    if (process.platform !== 'win32') {
      expect((await stat(join(setup.home, 'skills'))).mode & 0o777).toBe(0o700);
    }
  });

  it('writes the marker with the managed owner, the folder id and the library hash', async () => {
    const setup = await claudeSetup();
    const item = await libraryItem({ root: setup.root, id: 's' });
    await applyAll(inputsFor(setup, [item]));
    expect(await readMarkerFile(setup.home, 's')).toEqual({
      managedBy: 'inova-ide',
      id: 's',
      hash: (item as { definition: { hash: string } }).definition.hash,
    });
  });

  it('plans no skill item without a library or without a root', async () => {
    const setup = await claudeSetup();
    const items = [await libraryItem({ root: setup.root, id: 's' })];
    const withoutLibrary = await previewProfileSync({
      root: setup.root,
      projectPath: setup.project,
      accounts: setup.accounts,
    });
    const withoutRoot = await previewProfileSync({
      projectPath: setup.project,
      accounts: setup.accounts,
      library: { items, projectDisabled: [] },
    });
    expect(withoutLibrary.items.filter((item) => item.scope === 'skill')).toEqual([]);
    expect(withoutRoot.items.filter((item) => item.scope === 'skill')).toEqual([]);

    await applyProfileSync({
      root: setup.root,
      projectPath: setup.project,
      accounts: setup.accounts,
      approvedIds: [],
    });
    expect(await exists(join(setup.home, 'skills'))).toBe(false);
  });

  it.each([
    ['gemini', 'plugin'],
    ['opencode', 'fora da conta'],
    ['deepseek', 'sem suporte'],
    ['qwen', 'não verificada'],
    ['kimi', 'não verificada'],
    ['grok', 'não verificada'],
  ] as const)(
    'gives one incompatible item per %s account, however many skills exist',
    async (provider, fragment) => {
      const root = await tmp();
      const setup: Setup = {
        root,
        project: await tmp(),
        accounts: [account('other', provider, await tmp())],
      };
      const items = [
        await libraryItem({ root, id: 'one' }),
        await libraryItem({ root, id: 'two' }),
      ];
      const preview = await previewProfileSync(inputsFor(setup, items));
      const listed = skillItems(preview, 'other');
      expect(listed).toHaveLength(1);
      expect(listed[0]?.status).toBe('incompatible');
      expect(listed[0]?.reason).toContain(fragment);
    },
  );

  it('gives no item to an unsupported account when no skill is effective', async () => {
    const root = await tmp();
    const setup: Setup = {
      root,
      project: await tmp(),
      accounts: [account('g', 'gemini', await tmp())],
    };
    const off = await libraryItem({ root, id: 'off', enabled: false });
    const preview = await previewProfileSync(inputsFor(setup, [off]));
    expect(skillItems(preview, 'g')).toEqual([]);
  });
});
