import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CommandRunner } from '@inova/core/providers';
import { saveStore } from '@inova/core/store';
import type { Account, ProviderId } from '@inova/core/types';
import { createLibraryHandlers } from '../src/main/library-handlers.js';
import type { ProfileSyncPreview, Result } from '../src/shared/api.js';

const SKILL_TEXT = '---\nname: demo\ndescription: Demo skill\n---\n\nBody\n';
const NEW_SKILL_TEXT = '---\nname: demo\ndescription: Demo skill v2\n---\n\nChanged body\n';
const LITERAL_SECRET = 'literal-secret-value-12345';
const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-library-handlers-')));
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(path: string): Promise<string> {
  return (await exists(path)) ? readFile(path, 'utf8') : '';
}

async function setup(providers: ProviderId[] = ['claude', 'codex']) {
  const root = await tmp();
  const projectPath = await tmp();
  const accounts: Account[] = [];
  for (const provider of providers) {
    accounts.push({
      id: `acc-${provider}`,
      provider,
      label: provider,
      homeDir: await tmp(),
      createdAt: '2026-11-17T10:00:00.000Z',
    });
  }
  await saveStore(root, {
    version: 1,
    accounts,
    projects: [{ id: 'proj-1', path: projectPath, accountId: 'acc-claude' }],
  });
  const run = vi.fn<CommandRunner['run']>(async () => ({ notFound: true }));
  const handlers = createLibraryHandlers({ root, baseEnv: async () => ({}), runner: { run } });
  const homeOf = (provider: ProviderId): string =>
    accounts.find((account) => account.provider === provider)?.homeDir ?? '';
  return { root, projectPath, handlers, homeOf };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function saveSkill(
  handlers: Setup['handlers'],
  input: { id?: string; content?: string; enabled?: boolean } = {},
): Promise<void> {
  unwrap(
    await handlers.saveLibraryItem({
      id: input.id ?? 'demo-skill',
      name: 'Demo skill',
      description: null,
      enabled: input.enabled ?? true,
      kind: 'skill',
      content: input.content ?? SKILL_TEXT,
    }),
  );
}

async function saveMcp(handlers: Setup['handlers'], id = 'demo-mcp'): Promise<void> {
  unwrap(
    await handlers.saveLibraryItem({
      id,
      name: 'Demo MCP',
      description: null,
      enabled: true,
      kind: 'mcp',
      definition: { command: 'npx', args: ['demo'] },
    }),
  );
}

async function preview(handlers: Setup['handlers']): Promise<ProfileSyncPreview> {
  return unwrap(await handlers.previewLibrarySync({ projectId: 'proj-1' }));
}

function statusOf(result: ProfileSyncPreview, id: string): string {
  return result.items.find((item) => item.id === id)?.status ?? 'absent';
}

describe('regra 1 e 2: criar uma vez vale para todos os providers', () => {
  test('skill e MCP aparecem para as contas claude e codex', async () => {
    const { handlers } = await setup();
    await saveSkill(handlers);
    await saveMcp(handlers);
    const result = await preview(handlers);
    expect(statusOf(result, 'skill:acc-claude:demo-skill')).toBe('create');
    expect(statusOf(result, 'skill:acc-codex:demo-skill')).toBe('create');
    expect(statusOf(result, 'mcp:acc-claude')).toBe('create');
    expect(statusOf(result, 'mcp:acc-codex')).toBe('create');
  });

  test('o apply grava a skill e o MCP nas duas contas', async () => {
    const { handlers, homeOf } = await setup();
    await saveSkill(handlers);
    await saveMcp(handlers);
    unwrap(await handlers.applyLibrarySync({ projectId: 'proj-1', approvedIds: [] }));
    for (const provider of ['claude', 'codex'] as const) {
      expect(
        await readFile(join(homeOf(provider), 'skills', 'demo-skill', 'SKILL.md'), 'utf8'),
      ).toBe(SKILL_TEXT);
    }
    expect(await readFile(join(homeOf('claude'), '.claude.json'), 'utf8')).toContain('demo-mcp');
    expect(await readFile(join(homeOf('codex'), 'config.toml'), 'utf8')).toContain('demo-mcp');
  });
});

describe('regra 7 e 9: o preview separa create, update, conflict e incompatible', () => {
  test('cada situação recebe o status correto', async () => {
    const { handlers, homeOf } = await setup(['claude', 'codex', 'deepseek']);
    await saveSkill(handlers);
    await saveMcp(handlers);
    await mkdir(join(homeOf('codex'), 'skills', 'demo-skill'), { recursive: true });
    await writeFile(join(homeOf('codex'), 'skills', 'demo-skill', 'SKILL.md'), 'mine');
    const first = await preview(handlers);
    expect(statusOf(first, 'skill:acc-claude:demo-skill')).toBe('create');
    expect(statusOf(first, 'skill:acc-codex:demo-skill')).toBe('conflict');
    expect(statusOf(first, 'skill:acc-deepseek')).toBe('incompatible');
    expect(statusOf(first, 'mcp:acc-deepseek')).toBe('incompatible');

    unwrap(await handlers.applyLibrarySync({ projectId: 'proj-1', approvedIds: [] }));
    expect(await readFile(join(homeOf('codex'), 'skills', 'demo-skill', 'SKILL.md'), 'utf8')).toBe(
      'mine',
    );
    await saveSkill(handlers, { content: NEW_SKILL_TEXT });
    const second = await preview(handlers);
    expect(statusOf(second, 'skill:acc-claude:demo-skill')).toBe('update');
  });

  test('um provider sem suporte não bloqueia os outros', async () => {
    const { handlers, homeOf } = await setup(['claude', 'deepseek']);
    await saveSkill(handlers);
    const result = unwrap(
      await handlers.applyLibrarySync({ projectId: 'proj-1', approvedIds: [] }),
    );
    expect(result.skippedIds).toContain('skill:acc-deepseek');
    expect(await exists(join(homeOf('claude'), 'skills', 'demo-skill', 'SKILL.md'))).toBe(true);
  });
});

describe('regra 6: a biblioteca nunca grava valor de segredo', () => {
  test('env com valor literal é recusado e nada é gravado', async () => {
    const { root, handlers } = await setup();
    const result = await handlers.saveLibraryItem({
      id: 'leaky',
      name: 'Leaky',
      description: null,
      enabled: true,
      kind: 'mcp',
      definition: { command: 'npx', env: { TOKEN: LITERAL_SECRET } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain(LITERAL_SECRET);
    expect(await readIfExists(join(root, 'library', 'library.json'))).not.toContain(LITERAL_SECRET);
    expect(unwrap(await handlers.listLibrary()).items).toEqual([]);
  });

  test('header literal de conector é recusado', async () => {
    const { root, handlers } = await setup();
    const result = await handlers.saveLibraryItem({
      id: 'leaky-remote',
      name: 'Leaky',
      description: null,
      enabled: true,
      kind: 'connector',
      label: 'Leaky',
      definition: {
        type: 'http',
        url: 'https://x.dev/mcp',
        headers: { Authorization: LITERAL_SECRET },
      },
    });
    expect(result.ok).toBe(false);
    expect(await readIfExists(join(root, 'library', 'library.json'))).not.toContain(LITERAL_SECRET);
  });

  test('env com referência ${TOKEN} é aceito e só a referência é gravada', async () => {
    const { root, handlers } = await setup();
    const result = await handlers.saveLibraryItem({
      id: 'safe',
      name: 'Safe',
      description: null,
      enabled: true,
      kind: 'mcp',
      definition: { command: 'npx', env: { TOKEN: '${TOKEN}' } },
    });
    expect(result.ok).toBe(true);
    expect(await readFile(join(root, 'library', 'library.json'), 'utf8')).toContain('${TOKEN}');
  });
});

describe('a sincronização da biblioteca não cria arquivos de regras', () => {
  test('AGENTS.md existente não gera CLAUDE.md nem altera o AGENTS.md', async () => {
    const { handlers, projectPath } = await setup();
    await writeFile(join(projectPath, 'AGENTS.md'), '# rules\n');
    await saveSkill(handlers);
    await saveMcp(handlers);
    const result = await preview(handlers);
    expect(result.items.some((item) => item.scope === 'rules')).toBe(false);
    const applied = unwrap(
      await handlers.applyLibrarySync({
        projectId: 'proj-1',
        approvedIds: result.items.map((item) => item.id),
      }),
    );
    expect(applied.appliedIds.some((id) => id.startsWith('rules:'))).toBe(false);
    expect(await exists(join(projectPath, 'CLAUDE.md'))).toBe(false);
    expect(await readFile(join(projectPath, 'AGENTS.md'), 'utf8')).toBe('# rules\n');
  });
});

describe('regra 1 e 2: item desligado ou desligado no projeto não chega ao provider', () => {
  test('enabled false não aparece no preview', async () => {
    const { handlers } = await setup();
    await saveSkill(handlers, { enabled: false });
    const result = await preview(handlers);
    expect(result.items.some((item) => item.scope === 'skill')).toBe(false);
  });

  test('override do projeto tira o item do preview e pode ser desfeito', async () => {
    const { handlers } = await setup();
    await saveSkill(handlers);
    expect(
      unwrap(
        await handlers.setProjectOverride({
          projectId: 'proj-1',
          itemId: 'demo-skill',
          disabled: true,
        }),
      ),
    ).toEqual({ disabled: ['demo-skill'] });
    expect((await preview(handlers)).items.some((item) => item.scope === 'skill')).toBe(false);
    expect(
      unwrap(
        await handlers.setProjectOverride({
          projectId: 'proj-1',
          itemId: 'demo-skill',
          disabled: false,
        }),
      ),
    ).toEqual({ disabled: [] });
    expect(statusOf(await preview(handlers), 'skill:acc-claude:demo-skill')).toBe('create');
  });

  test('override de um MCP tira o servidor do que seria gravado', async () => {
    const { handlers } = await setup(['claude']);
    await saveMcp(handlers);
    expect(statusOf(await preview(handlers), 'mcp:acc-claude')).toBe('create');
    unwrap(
      await handlers.setProjectOverride({
        projectId: 'proj-1',
        itemId: 'demo-mcp',
        disabled: true,
      }),
    );
    const result = await preview(handlers);
    expect(statusOf(result, 'mcp:acc-claude')).toBe('unchanged');
    expect(JSON.stringify(result.items)).not.toContain('demo-mcp');
  });
});

describe('regra 8: remover da biblioteca remove só a projeção marcada, após preview', () => {
  test('a pasta do provider só some no apply com o id aprovado', async () => {
    const { root, handlers, homeOf } = await setup(['claude']);
    await saveSkill(handlers);
    unwrap(await handlers.applyLibrarySync({ projectId: 'proj-1', approvedIds: [] }));
    const projected = join(homeOf('claude'), 'skills', 'demo-skill');
    expect(await exists(projected)).toBe(true);

    expect(unwrap(await handlers.removeLibraryItem({ id: 'demo-skill' }))).toEqual({
      removed: true,
    });
    expect(await exists(join(root, 'library', 'skills', 'demo-skill'))).toBe(false);
    expect(unwrap(await handlers.listLibrary()).items).toEqual([]);

    expect(statusOf(await preview(handlers), 'skill:acc-claude:demo-skill')).toBe('remove');
    expect(await exists(projected)).toBe(true);

    unwrap(await handlers.applyLibrarySync({ projectId: 'proj-1', approvedIds: [] }));
    expect(await exists(projected)).toBe(true);

    unwrap(
      await handlers.applyLibrarySync({
        projectId: 'proj-1',
        approvedIds: ['skill:acc-claude:demo-skill'],
      }),
    );
    expect(await exists(projected)).toBe(false);
  });

  test('uma pasta de skill sem marcador nunca é removida', async () => {
    const { handlers, homeOf } = await setup(['claude']);
    const foreign = join(homeOf('claude'), 'skills', 'not-mine');
    await mkdir(foreign, { recursive: true });
    await writeFile(join(foreign, 'SKILL.md'), 'user skill');
    const result = unwrap(
      await handlers.applyLibrarySync({
        projectId: 'proj-1',
        approvedIds: ['skill:acc-claude:not-mine'],
      }),
    );
    expect(result.appliedIds).toEqual([]);
    expect(await readFile(join(foreign, 'SKILL.md'), 'utf8')).toBe('user skill');
  });
});
