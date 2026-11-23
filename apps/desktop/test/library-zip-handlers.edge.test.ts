import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createZipBuffer } from '@inova/core/library/index';
import type { CommandRunner } from '@inova/core/providers';
import { saveStore } from '@inova/core/store';
import type { Account, ProviderId } from '@inova/core/types';
import type { ChatRunner } from '../src/main/chat.js';
import { createHandlers } from '../src/main/handlers.js';
import { createLibraryHandlers } from '../src/main/library-handlers.js';
import { emptyForm, formFromItem, buildSaveInput } from '../src/renderer/library-form.js';
import { projectSkillPluginState } from '../src/renderer/library-state.js';
import type { Result } from '../src/shared/api.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-zip-handlers-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

async function setup(provider: ProviderId = 'claude') {
  const root = await tmp();
  const projectPath = await tmp();
  const binDir = await tmp();
  const binaryName = provider === 'gemini' ? 'agy' : provider;
  const binaryPath = join(binDir, binaryName);
  await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });

  const account: Account = {
    id: `acc-${provider}`,
    provider,
    label: provider,
    homeDir: await tmp(),
    createdAt: '2026-11-23T10:00:00.000Z',
  };
  await saveStore(root, {
    version: 1,
    accounts: [account],
    projects: [{ id: 'proj-1', path: projectPath, accountId: account.id }],
  });

  const send = vi.fn<ChatRunner['send']>();
  const chat: ChatRunner = {
    send,
    cancel: vi.fn(),
    isRunning: () => false,
    accountsInUse: () => new Set(),
    closeAll: async () => undefined,
  };
  const runner: CommandRunner = { run: vi.fn(async () => ({ notFound: true as const })) };
  const baseEnv = async () => ({ PATH: binDir, HOME: root });
  const pickLibraryZip = vi.fn(async () => null as string | null);

  const libraryHandlers = createLibraryHandlers({ root, baseEnv, runner, pickLibraryZip });
  const handlers = createHandlers({
    root,
    runner,
    sessions: {
      create: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      closeAll: async () => undefined,
    } as never,
    chat,
    usageDeps: {
      platform: process.platform,
      runner,
      fetch: vi.fn(),
      now: () => new Date('2026-11-23T10:00:00.000Z'),
    },
    emit: vi.fn(),
    baseEnv,
    pickFolder: async () => null,
    pickAttachments: async () => [],
  });

  return { root, projectPath, handlers, libraryHandlers, pickLibraryZip, send };
}

describe('library ZIP import and project binding handlers', () => {
  test('imports skill & plugin ZIPs, preserves metadata on edit, and handles invalid files', async () => {
    const { root, libraryHandlers, pickLibraryZip } = await setup();
    expect(unwrap(await libraryHandlers.pickLibraryZip())).toBeNull();
    expect(pickLibraryZip).toHaveBeenCalledOnce();

    const missing = await libraryHandlers.importLibraryZip({
      zipPath: join(root, 'missing.zip'),
    });
    expect(missing.ok).toBe(false);

    const zipPath = join(root, 'pack.zip');
    await writeFile(
      zipPath,
      createZipBuffer([
        {
          path: '.claude-plugin/plugin.json',
          data: JSON.stringify({ name: 'Team Pack', version: '2.0.0' }),
        },
        {
          path: 'skills/audit/SKILL.md',
          data: '---\nname: audit\ndescription: Audit code\n---\n\nAudit $ARGUMENTS.',
        },
      ]),
    );

    const imported = unwrap(await libraryHandlers.importLibraryZip({ zipPath }));
    expect(imported.kind).toBe('plugin');

    const edited = unwrap(
      await libraryHandlers.saveLibraryItem({
        id: imported.item.id,
        name: 'Team Pack Renamed',
        description: 'Updated description',
        enabled: true,
        kind: 'plugin',
      }),
    );
    expect(edited.source).toBe('imported');
    expect(edited.name).toBe('Team Pack Renamed');
    if (edited.kind === 'plugin') {
      expect('format' in edited.definition && edited.definition.format).toBe('package');
    }

    const listing = unwrap(await libraryHandlers.listLibrary());
    expect(listing.pluginRecipes[imported.item.id]).toBeUndefined();

    const form = formFromItem(edited);
    expect(form.pluginPackage).toBe(true);
    const built = buildSaveInput(form);
    expect(built.ok).toBe(true);
    expect(emptyForm('plugin').pluginPackage).toBe(false);
  });

  test('lists and expands /<skill> only when imported and active in the project, and suppresses disabled skills on claude', async () => {
    const { root, handlers, libraryHandlers, send } = await setup('claude');
    const zipPath = join(root, 'my-skill.zip');
    await writeFile(
      zipPath,
      createZipBuffer([
        {
          path: 'SKILL.md',
          data: '---\nname: my-skill\ndescription: Helpful skill\n---\n\nExecute step for $ARGUMENTS.',
        },
        { path: 'scripts/run.sh', data: '#!/bin/sh\necho hi\n' },
      ]),
    );
    unwrap(await libraryHandlers.importLibraryZip({ zipPath }));

    expect(unwrap(await handlers.listCommands({ projectId: 'proj-1' }))).toEqual([]);

    const session = unwrap(await handlers.createSession({ projectId: 'proj-1' }));
    unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: '/my-skill foo' }));
    const firstSpec = send.mock.calls[0]?.[0].spec;
    expect(firstSpec?.args.at(-1)).toBe('/my-skill foo');
    expect(firstSpec?.args).toContain('--settings');
    expect(firstSpec?.args.join(' ')).toContain('"my-skill":"off"');

    const bound = unwrap(
      await libraryHandlers.setProjectLibraryBinding({
        projectId: 'proj-1',
        itemId: 'my-skill',
        enabled: true,
      }),
    );
    expect(bound.bindings).toEqual([{ itemId: 'my-skill', enabled: true }]);

    const commands = unwrap(await handlers.listCommands({ projectId: 'proj-1' }));
    expect(commands.map((c) => ({ name: c.name, source: c.source }))).toEqual([
      { name: 'my-skill', source: 'library' },
    ]);

    const state = projectSkillPluginState({
      items: unwrap(await libraryHandlers.listLibrary()).items,
      bindings: bound.bindings,
    });
    expect(state.imported.map((row) => row.item.id)).toEqual(['my-skill']);
    expect(state.available).toEqual([]);

    unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: '/my-skill src/app.ts' }));
    const secondSpec = send.mock.calls[1]?.[0].spec;
    expect(secondSpec?.args.at(-1)).toContain('Execute step for src/app.ts.');
    expect(secondSpec?.args).toContain('--add-dir');
    expect(secondSpec?.args.join(' ')).not.toContain('"my-skill":"off"');

    unwrap(
      await libraryHandlers.setProjectLibraryBinding({
        projectId: 'proj-1',
        itemId: 'my-skill',
        enabled: false,
      }),
    );
    expect(unwrap(await handlers.listCommands({ projectId: 'proj-1' }))).toEqual([]);

    const afterRemove = unwrap(
      await libraryHandlers.removeProjectLibraryBinding({
        projectId: 'proj-1',
        itemId: 'my-skill',
      }),
    );
    expect(afterRemove.bindings).toEqual([]);
  });

  test('rejects binding non-skill/non-plugin library items and expands skills for non-claude providers', async () => {
    const { root, handlers, libraryHandlers, send } = await setup('gemini');
    unwrap(
      await libraryHandlers.saveLibraryItem({
        id: 'demo-mcp',
        name: 'Demo MCP',
        description: null,
        enabled: true,
        kind: 'mcp',
        definition: { command: 'npx', args: ['demo'] },
      }),
    );
    const badBinding = await libraryHandlers.setProjectLibraryBinding({
      projectId: 'proj-1',
      itemId: 'demo-mcp',
      enabled: true,
    });
    expect(badBinding.ok).toBe(false);

    const pluginZip = join(root, 'plugin.zip');
    await writeFile(
      pluginZip,
      createZipBuffer([
        { path: '.codex-plugin/plugin.json', data: JSON.stringify({ name: 'Cross Kit' }) },
        {
          path: 'skills/plan-fix/SKILL.md',
          data: '---\nname: plan-fix\ndescription: Plan fix\n---\n\nPlan $ARGUMENTS.',
        },
      ]),
    );
    unwrap(await libraryHandlers.importLibraryZip({ zipPath: pluginZip }));
    unwrap(
      await libraryHandlers.setProjectLibraryBinding({
        projectId: 'proj-1',
        itemId: 'cross-kit',
        enabled: true,
      }),
    );

    const session = unwrap(await handlers.createSession({ projectId: 'proj-1' }));
    unwrap(await handlers.sendMessage({ sessionId: session.id, prompt: '/plan-fix bug' }));
    expect(send.mock.calls[0]?.[0].spec.args.join(' ')).toContain('Plan bug.');
  });
});
