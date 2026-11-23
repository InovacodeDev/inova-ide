import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addAccount } from '../accounts.js';
import { bindProject, removeProjectLibraryBinding, setProjectLibraryBinding } from '../projects.js';
import { loadStore } from '../store.js';
import {
  createZipBuffer,
  extractZipEntries,
  importLibraryZip,
  loadLibrary,
  MAX_ZIP_BYTES,
  parseSkillFrontMatter,
  pluginDir,
  setLibraryItemEnabled,
  skillDir,
  stripCommonZipRoot,
  validateLibraryItem,
  ZipError,
  ZipImportError,
} from './index.js';

let root: string;
let projectPath: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'inova-zip-edge-')));
  projectPath = await realpath(await mkdtemp(join(tmpdir(), 'inova-zip-edge-proj-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(projectPath, { recursive: true, force: true });
});

describe('zip reader edge cases', () => {
  it('filters OS noise folders and accepts .env.example while rejecting real .env', () => {
    const safeZip = createZipBuffer([
      { path: '__MACOSX/._SKILL.md', data: 'noise' },
      { path: 'my-skill/.DS_Store', data: 'noise' },
      { path: 'my-skill/.git/HEAD', data: 'ref: refs/heads/main' },
      { path: 'my-skill/node_modules/x/index.js', data: 'module.exports = 1' },
      { path: 'my-skill/.env.example', data: 'API_KEY=' },
      {
        path: 'my-skill/SKILL.md',
        data: '---\nname: my-skill\ndescription: Safe skill\n---\n\nBody',
      },
    ]);

    const entries = stripCommonZipRoot(extractZipEntries(safeZip));
    expect(entries.map((entry) => entry.path).sort()).toEqual(['.env.example', 'SKILL.md']);
  });

  it('preserves reserved top-level skills/ folder when no wrapper root exists', () => {
    const barePluginSkills = createZipBuffer([
      {
        path: 'skills/one/SKILL.md',
        data: '---\nname: one\ndescription: First\n---\n\nBody one',
      },
      {
        path: 'skills/two/SKILL.md',
        data: '---\nname: two\ndescription: Second\n---\n\nBody two',
      },
    ]);
    const stripped = stripCommonZipRoot(extractZipEntries(barePluginSkills));
    expect(stripped.map((entry) => entry.path)).toEqual([
      'skills/one/SKILL.md',
      'skills/two/SKILL.md',
    ]);
  });

  it('rejects truncated, encrypted, symlink, duplicate, and oversized ZIPs', () => {
    expect(() => extractZipEntries(Buffer.from('not-a-zip'))).toThrow(ZipError);
    expect(() => extractZipEntries(Buffer.alloc(MAX_ZIP_BYTES + 1))).toThrow(ZipError);

    const dupZip = createZipBuffer([
      { path: 'SKILL.md', data: 'a' },
      { path: 'skill.md', data: 'b' },
    ]);
    expect(() => extractZipEntries(dupZip)).toThrow(ZipError);

    const encrypted = createZipBuffer([{ path: 'SKILL.md', data: 'a' }]);
    const cdOffset = encrypted.readUInt32LE(encrypted.length - 6);
    encrypted.writeUInt16LE(0x0001, cdOffset + 8);
    expect(() => extractZipEntries(encrypted)).toThrow(ZipError);

    const symlinkZip = createZipBuffer([{ path: 'alias', data: '/etc/passwd' }]);
    const symlinkCdOffset = symlinkZip.readUInt32LE(symlinkZip.length - 6);
    symlinkZip.writeUInt32LE((0o120777 << 16) >>> 0, symlinkCdOffset + 38);
    expect(() => extractZipEntries(symlinkZip)).toThrow(ZipError);
  });
});

describe('zip import edge cases', () => {
  it('supports multiline YAML descriptions in SKILL.md', async () => {
    const content = [
      '---',
      'name: Multi Line',
      'description: >',
      '  First sentence',
      '  second sentence',
      '---',
      '',
      'Do work here.',
    ].join('\n');

    const parsed = parseSkillFrontMatter(content);
    expect(parsed.description).toBe('First sentence second sentence');

    const zip = createZipBuffer([{ path: 'SKILL.md', data: content }]);
    const imported = await importLibraryZip({ root, buffer: zip });
    expect(imported.item.description).toBe('First sentence second sentence');
  });

  it('re-importing preserves enabled=false and creates a backup of the previous folder', async () => {
    const v1 = createZipBuffer([
      {
        path: 'SKILL.md',
        data: '---\nname: updater\ndescription: V1\n---\n\nBody v1',
      },
    ]);
    await importLibraryZip({ root, buffer: v1 });
    await setLibraryItemEnabled({ root, id: 'updater', enabled: false });

    const v2 = createZipBuffer([
      {
        path: 'SKILL.md',
        data: '---\nname: updater\ndescription: V2\n---\n\nBody v2',
      },
    ]);
    const second = await importLibraryZip({ root, buffer: v2 });

    expect(second.replaced).toBe(true);
    expect(second.item.enabled).toBe(false);
    expect(await readFile(join(skillDir(root, 'updater'), 'SKILL.md'), 'utf8')).toContain(
      'Body v2',
    );
  });

  it('imports plugin ZIP with custom manifest skill/command paths, TOML commands, and no manifest fallback', async () => {
    const customManifest = createZipBuffer([
      {
        path: '.codex-plugin/plugin.json',
        data: JSON.stringify({
          name: 'Custom Paths',
          skills: ['./extra-skills'],
          commands: ['./custom-cmds'],
          mcpServers: { local: { command: 'node', env: { TOKEN: '${TOKEN}' } } },
        }),
      },
      {
        path: 'extra-skills/analyzer/SKILL.md',
        data: '---\nname: analyzer\ndescription: Analyze\n---\n\nAnalyze $ARGUMENTS',
      },
      {
        path: 'custom-cmds/ops/ping.toml',
        data: 'description = "Ping cluster"\nprompt = "Ping $ARGUMENTS"\n',
      },
    ]);
    const res1 = await importLibraryZip({ root, buffer: customManifest });
    expect(res1.kind).toBe('plugin');
    if (
      res1.kind === 'plugin' &&
      'format' in res1.item.definition &&
      res1.item.definition.format === 'package'
    ) {
      expect(res1.item.definition.skills.map((s) => s.id)).toEqual(['analyzer']);
      expect(res1.item.definition.commands.map((c) => c.name)).toEqual(['ops:ping']);
      expect(res1.item.definition.mcpServers).toEqual(['local']);
    }

    const noManifestZip = createZipBuffer([
      {
        path: 'skills/bare-skill/SKILL.md',
        data: '---\nname: bare-skill\ndescription: Bare\n---\n\nBare body',
      },
    ]);
    const res2 = await importLibraryZip({
      root,
      buffer: noManifestZip,
      fileName: 'Bare Pack.zip',
    });
    expect(res2.kind).toBe('plugin');
    expect(res2.item.id).toBe('bare-pack');
    expect(
      await readFile(
        join(pluginDir(root, 'bare-pack'), 'skills', 'bare-skill', 'SKILL.md'),
        'utf8',
      ),
    ).toContain('Bare body');
  });

  it('rejects expectedKind mismatch, kind collision, and invalid manifests', async () => {
    const skillZip = createZipBuffer([
      {
        path: 'SKILL.md',
        data: '---\nname: shared-id\ndescription: Skill\n---\n\nBody',
      },
    ]);
    await expect(
      importLibraryZip({ root, buffer: skillZip, expectedKind: 'plugin' }),
    ).rejects.toBeInstanceOf(ZipImportError);

    await importLibraryZip({ root, buffer: skillZip });

    const pluginSameId = createZipBuffer([
      { path: '.claude-plugin/plugin.json', data: JSON.stringify({ name: 'shared-id' }) },
    ]);
    await expect(importLibraryZip({ root, buffer: pluginSameId })).rejects.toBeInstanceOf(
      ZipImportError,
    );

    const badManifest = createZipBuffer([
      { path: '.claude-plugin/plugin.json', data: '{not-json' },
    ]);
    await expect(importLibraryZip({ root, buffer: badManifest })).rejects.toBeInstanceOf(
      ZipImportError,
    );

    const unrecognized = createZipBuffer([{ path: 'README.md', data: 'hello' }]);
    await expect(importLibraryZip({ root, buffer: unrecognized })).rejects.toBeInstanceOf(
      ZipImportError,
    );
  });

  it('validates plugin package definitions and manages project bindings', async () => {
    const valid = validateLibraryItem({
      id: 'pkg',
      kind: 'plugin',
      name: 'Pkg',
      description: null,
      enabled: true,
      source: 'imported',
      updatedAt: '2026-11-23T10:00:00.000Z',
      definition: {
        format: 'package',
        manifestFormat: 'claude',
        hash: 'a1b2c3d4e5f60718',
        skills: [{ id: 's1', name: 'S1', description: null, path: 'skills/s1' }],
        commands: [{ name: 'cmd', description: null, path: 'commands/cmd.md' }],
      },
    });
    expect(valid.ok).toBe(true);

    const traversal = validateLibraryItem({
      id: 'pkg',
      kind: 'plugin',
      name: 'Pkg',
      description: null,
      enabled: true,
      source: 'imported',
      updatedAt: '2026-11-23T10:00:00.000Z',
      definition: {
        format: 'package',
        manifestFormat: 'claude',
        hash: 'a1b2c3d4e5f60718',
        skills: [{ id: 's1', name: 'S1', description: null, path: '../escape' }],
        commands: [],
      },
    });
    expect(traversal.ok).toBe(false);

    await addAccount({ root, provider: 'claude', label: 'a' });
    const project = await bindProject({ root, path: projectPath, accountLabel: 'a' });
    await setProjectLibraryBinding({
      root,
      projectId: project.id,
      itemId: 'pkg',
      enabled: true,
      disabledSkills: ['s1'],
    });
    await setProjectLibraryBinding({
      root,
      projectId: project.id,
      itemId: 'pkg',
      enabled: false,
    });
    const afterUpdate = (await loadStore(root)).projects[0]!;
    expect(afterUpdate.libraryBindings).toEqual([
      { itemId: 'pkg', enabled: false, disabledSkills: ['s1'] },
    ]);

    await removeProjectLibraryBinding({ root, projectId: project.id, itemId: 'pkg' });
    expect((await loadStore(root)).projects[0]?.libraryBindings).toEqual([]);
    expect((await loadLibrary(root)).items).toEqual([]);
  });
});
