import { mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectCommand } from '../commands.js';
import { bindProject, setProjectLibraryBinding } from '../projects.js';
import { addAccount } from '../accounts.js';
import { loadStore } from '../store.js';
import {
  createZipBuffer,
  findSlashCommand,
  formatSkillExecutionPrompt,
  importLibraryZip,
  loadLibrary,
  mergeProjectAndLibraryCommands,
  pluginDir,
  removeLibraryItem,
  resolveProjectLibraryCommands,
  setLibraryItemEnabled,
  skillDir,
  ZipError,
  ZipImportError,
} from './index.js';

let root: string;
let projectPath: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'inova-zip-contract-')));
  projectPath = await realpath(await mkdtemp(join(tmpdir(), 'inova-zip-proj-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(projectPath, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('ZIP import and project skill activation contract', () => {
  it('imports a skill ZIP with a wrapper root folder and stores it centrally', async () => {
    const buffer = createZipBuffer([
      {
        path: 'code-audit-main/SKILL.md',
        data: '---\nname: Code Audit\ndescription: Audits code carefully\n---\n\nCheck $ARGUMENTS now.\n',
      },
      {
        path: 'code-audit-main/scripts/check.sh',
        data: '#!/bin/sh\necho ok\n',
        executable: true,
      },
    ]);

    const imported = await importLibraryZip({ root, buffer, fileName: 'code-audit.zip' });

    expect(imported.kind).toBe('skill');
    expect(imported.replaced).toBe(false);
    expect(imported.item.id).toBe('code-audit');
    expect(imported.item.source).toBe('imported');
    expect(imported.item.enabled).toBe(true);
    expect(await exists(join(skillDir(root, 'code-audit'), 'SKILL.md'))).toBe(true);
    expect(await exists(join(skillDir(root, 'code-audit'), 'scripts', 'check.sh'))).toBe(true);
    expect((await loadLibrary(root)).items.map((item) => item.id)).toEqual(['code-audit']);
  });

  it.each([
    ['claude', '.claude-plugin/plugin.json'],
    ['codex', '.codex-plugin/plugin.json'],
    ['cursor', '.cursor-plugin/plugin.json'],
    ['antigravity', '.antigravity-plugin/plugin.json'],
    ['antigravity', 'plugin.json'],
    ['antigravity', 'gemini-extension.json'],
  ] as const)(
    'imports market plugin ZIP format %s (%s) with skills and commands',
    async (expectedFormat, manifestPath) => {
      const buffer = createZipBuffer([
        {
          path: `bundle/${manifestPath}`,
          data: JSON.stringify({
            name: 'Market Kit',
            version: '1.2.0',
            description: 'Standard plugin bundle',
          }),
        },
        {
          path: 'bundle/skills/review-diff/SKILL.md',
          data: '---\nname: review-diff\ndescription: Review diff lines\n---\n\nReview $ARGUMENTS carefully.\n',
        },
        {
          path: 'bundle/commands/deploy.md',
          data: '---\ndescription: Deploy app\n---\n\nDeploy $ARGUMENTS.\n',
        },
        {
          path: 'bundle/.mcp.json',
          data: JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['docs-mcp'] } } }),
        },
      ]);

      const imported = await importLibraryZip({ root, buffer });

      expect(imported.kind).toBe('plugin');
      if (imported.kind !== 'plugin') return;
      expect(imported.item.id).toBe('market-kit');
      expect(imported.item.source).toBe('imported');
      expect(imported.item.definition).toMatchObject({
        format: 'package',
        manifestFormat: expectedFormat,
        version: '1.2.0',
        mcpServers: ['docs'],
      });
      if ('format' in imported.item.definition && imported.item.definition.format === 'package') {
        expect(imported.item.definition.skills.map((skill) => skill.id)).toEqual(['review-diff']);
        expect(imported.item.definition.commands.map((cmd) => cmd.name)).toEqual(['deploy']);
      }
      expect(
        await exists(join(pluginDir(root, 'market-kit'), 'skills', 'review-diff', 'SKILL.md')),
      ).toBe(true);
    },
  );

  it('keeps skills isolated from projects until imported and toggled on in the project', async () => {
    await addAccount({ root, provider: 'claude', label: 'main' });
    const project = await bindProject({ root, path: projectPath, accountLabel: 'main' });

    const skillZip = createZipBuffer([
      {
        path: 'SKILL.md',
        data: '---\nname: token-saver\ndescription: Saves context tokens\n---\n\nRun $ARGUMENTS.\n',
      },
      { path: 'references/guide.md', data: 'Guide content' },
    ]);
    await importLibraryZip({ root, buffer: skillZip });

    const pluginZip = createZipBuffer([
      {
        path: '.claude-plugin/plugin.json',
        data: JSON.stringify({ name: 'Workflow Kit', version: '1.0.0' }),
      },
      {
        path: 'skills/fast-check/SKILL.md',
        data: '---\nname: fast-check\ndescription: Fast checks\n---\n\nCheck fast.',
      },
      {
        path: 'skills/deep-audit/SKILL.md',
        data: '---\nname: deep-audit\ndescription: Deep audit\n---\n\nAudit deep.',
      },
    ]);
    await importLibraryZip({ root, buffer: pluginZip });

    const libraryBefore = await loadLibrary(root);
    expect(await resolveProjectLibraryCommands({ root, library: libraryBefore, project })).toEqual(
      [],
    );

    await setProjectLibraryBinding({
      root,
      projectId: project.id,
      itemId: 'token-saver',
      enabled: true,
    });
    await setProjectLibraryBinding({
      root,
      projectId: project.id,
      itemId: 'workflow-kit',
      enabled: true,
      disabledSkills: ['deep-audit'],
    });

    const boundProject = (await loadStore(root)).projects.find((p) => p.id === project.id)!;
    const activeCommands = await resolveProjectLibraryCommands({
      root,
      library: await loadLibrary(root),
      project: boundProject,
    });

    expect(activeCommands.map((cmd) => cmd.name)).toEqual(['token-saver', 'fast-check']);
    const tokenSaver = activeCommands.find((cmd) => cmd.name === 'token-saver')!;
    expect(tokenSaver.resourceDir).toBe(await realpath(skillDir(root, 'token-saver')));
    expect(formatSkillExecutionPrompt({ command: tokenSaver, args: 'src/' })).toContain(
      'Run src/.',
    );

    await setProjectLibraryBinding({
      root,
      projectId: project.id,
      itemId: 'token-saver',
      enabled: false,
    });
    const toggledOffProject = (await loadStore(root)).projects.find((p) => p.id === project.id)!;
    expect(
      (
        await resolveProjectLibraryCommands({
          root,
          library: await loadLibrary(root),
          project: toggledOffProject,
        })
      ).map((cmd) => cmd.name),
    ).toEqual(['fast-check']);

    await setLibraryItemEnabled({ root, id: 'workflow-kit', enabled: false });
    expect(
      await resolveProjectLibraryCommands({
        root,
        library: await loadLibrary(root),
        project: toggledOffProject,
      }),
    ).toEqual([]);
  });

  it('gives local project commands precedence and namespaces colliding plugin skills', () => {
    const local: ProjectCommand[] = [
      {
        name: 'review',
        description: 'Local review',
        source: 'claude',
        kind: 'command',
        body: 'local',
      },
    ];
    const library: ProjectCommand[] = [
      {
        name: 'review',
        description: 'Plugin A review',
        source: 'plugin',
        kind: 'skill',
        body: 'plugin-a',
        libraryItemId: 'plugin-a',
        pluginId: 'plugin-a',
        pluginName: 'Plugin A',
      },
      {
        name: 'shared',
        description: 'Plugin A shared',
        source: 'plugin',
        kind: 'skill',
        body: 'shared-a',
        libraryItemId: 'plugin-a',
        pluginId: 'plugin-a',
        pluginName: 'Plugin A',
      },
      {
        name: 'shared',
        description: 'Plugin B shared',
        source: 'plugin',
        kind: 'skill',
        body: 'shared-b',
        libraryItemId: 'plugin-b',
        pluginId: 'plugin-b',
        pluginName: 'Plugin B',
      },
    ];

    const merged = mergeProjectAndLibraryCommands({ local, library });
    expect(merged.map((cmd) => cmd.name)).toEqual([
      'plugin-a:review',
      'plugin-b:shared',
      'review',
      'shared',
    ]);
    expect(findSlashCommand(merged, 'review')?.body).toBe('local');
    expect(findSlashCommand(merged, 'plugin-a:review')?.body).toBe('plugin-a');
    expect(findSlashCommand(merged, 'shared')?.body).toBe('shared-a');
    expect(findSlashCommand(merged, 'plugin-b:shared')?.body).toBe('shared-b');
  });

  it('rejects secrets, .env files, and path traversal in ZIP without writing to disk', async () => {
    const envZip = createZipBuffer([
      {
        path: 'SKILL.md',
        data: '---\nname: safe\ndescription: Safe skill\n---\n\nBody',
      },
      { path: '.env.local', data: 'SECRET=123' },
    ]);
    await expect(importLibraryZip({ root, buffer: envZip })).rejects.toBeInstanceOf(ZipError);

    const traversalZip = createZipBuffer([
      {
        path: '../escape/SKILL.md',
        data: '---\nname: escape\ndescription: Bad\n---\n\nBody',
      },
    ]);
    await expect(importLibraryZip({ root, buffer: traversalZip })).rejects.toBeInstanceOf(ZipError);

    const secretZip = createZipBuffer([
      {
        path: 'SKILL.md',
        data: '---\nname: leaky\ndescription: Leaky\n---\n\nUse sk-abcdefghijklmnopqrstuvwxyz123456',
      },
    ]);
    await expect(importLibraryZip({ root, buffer: secretZip })).rejects.toBeInstanceOf(
      ZipImportError,
    );

    const mcpSecretZip = createZipBuffer([
      { path: '.claude-plugin/plugin.json', data: JSON.stringify({ name: 'Bad MCP' }) },
      {
        path: '.mcp.json',
        data: JSON.stringify({
          mcpServers: { api: { command: 'npx', env: { KEY: 'ghp_1234567890abcdefghij1234' } } },
        }),
      },
    ]);
    await expect(importLibraryZip({ root, buffer: mcpSecretZip })).rejects.toBeInstanceOf(
      ZipImportError,
    );

    expect(await readdir(root)).toEqual([]);
  });

  it('backs up and removes the plugin directory when removing a ZIP plugin from library', async () => {
    const buffer = createZipBuffer([
      { path: '.claude-plugin/plugin.json', data: JSON.stringify({ name: 'Clean Me' }) },
      {
        path: 'skills/clean/SKILL.md',
        data: '---\nname: clean\ndescription: Clean\n---\n\nClean body',
      },
    ]);
    await importLibraryZip({ root, buffer });
    expect(await exists(pluginDir(root, 'clean-me'))).toBe(true);

    const removed = await removeLibraryItem({ root, id: 'clean-me' });
    expect(removed).toEqual({ removed: true });
    expect(await exists(pluginDir(root, 'clean-me'))).toBe(false);
    const stamps = await readdir(join(root, 'backups', 'library'));
    expect(stamps.length).toBe(1);
    const backedUp = await readFile(
      join(
        root,
        'backups',
        'library',
        stamps[0]!,
        'plugins',
        'clean-me',
        'skills',
        'clean',
        'SKILL.md',
      ),
      'utf8',
    );
    expect(backedUp).toContain('Clean body');
  });
});
