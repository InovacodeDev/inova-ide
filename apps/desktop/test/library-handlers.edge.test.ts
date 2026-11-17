import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CommandRunner } from '@inova/core/providers';
import { loadStore, saveStore } from '@inova/core/store';
import type { Account } from '@inova/core/types';
import { createLibraryHandlers } from '../src/main/library-handlers.js';
import type { LibraryHandlers } from '../src/main/library-handlers.js';
import type { Result } from '../src/shared/api.js';

const INVALID = { ok: false, message: 'Entrada inválida.' };
const SKILL_TEXT = '---\nname: demo\ndescription: Demo skill\n---\n\nBody\n';
const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-library-edge-')));
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

function messageOf(result: Result<unknown>): string {
  if (result.ok) throw new Error('expected a failure');
  return result.message;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function setup() {
  const root = await tmp();
  const projectPath = await tmp();
  const account: Account = {
    id: 'acc-claude',
    provider: 'claude',
    label: 'claude',
    homeDir: await tmp(),
    createdAt: '2026-11-17T10:00:00.000Z',
  };
  await saveStore(root, {
    version: 1,
    accounts: [account],
    projects: [{ id: 'proj-1', path: projectPath, accountId: account.id }],
  });
  const run = vi.fn<CommandRunner['run']>(async () => ({ notFound: true }));
  const handlers = createLibraryHandlers({ root, baseEnv: async () => ({}), runner: { run } });
  return { root, projectPath, account, handlers, run };
}

function skillInput(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: id,
    description: null,
    enabled: true,
    kind: 'skill',
    content: SKILL_TEXT,
    ...extra,
  };
}

function mcpInput(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: id,
    description: null,
    enabled: true,
    kind: 'mcp',
    definition: { command: 'npx', args: ['demo'] },
    ...extra,
  };
}

function wide(entries: number): Record<string, string> {
  return Object.fromEntries(Array.from({ length: entries }, (_, index) => [`K${index}`, '${V}']));
}

function nested(depth: number): unknown {
  return depth === 0 ? 'leaf' : { next: nested(depth - 1) };
}

function inputsFor(handlers: LibraryHandlers) {
  return {
    saveLibraryItem: (input: unknown) => handlers.saveLibraryItem(input),
    removeLibraryItem: (input: unknown) => handlers.removeLibraryItem(input),
    setProjectOverride: (input: unknown) => handlers.setProjectOverride(input),
    previewLibrarySync: (input: unknown) => handlers.previewLibrarySync(input),
    applyLibrarySync: (input: unknown) => handlers.applyLibrarySync(input),
  };
}

describe('entrada inválida é recusada na borda', () => {
  const garbage: unknown[] = [undefined, null, 'x', 42, true, [], [{ id: 'a' }]];

  test.each([
    'saveLibraryItem',
    'removeLibraryItem',
    'setProjectOverride',
    'previewLibrarySync',
    'applyLibrarySync',
  ] as const)('%s recusa valores que não são objeto', async (name) => {
    const { handlers } = await setup();
    for (const input of garbage) {
      expect(await inputsFor(handlers)[name](input)).toEqual(INVALID);
    }
  });

  test.each([
    ['chave desconhecida', skillInput('a', { extra: 1 })],
    ['definition em skill', skillInput('a', { definition: { hash: 'abcdef12' } })],
    ['content em mcp', mcpInput('a', { content: 'x' })],
    ['id com path traversal', skillInput('../x')],
    ['id com maiúscula', skillInput('Abc')],
    ['id vazio', skillInput('')],
    ['kind inválido', skillInput('a', { kind: 'script' })],
    ['kind ausente', { id: 'a', name: 'a', description: null, enabled: true }],
    ['enabled como string', skillInput('a', { enabled: 'true' })],
    ['description acima de 500', skillInput('a', { description: 'd'.repeat(501) })],
    ['name acima de 100', skillInput('a', { name: 'n'.repeat(101) })],
    ['content gigante', skillInput('a', { content: 'x'.repeat(262_145) })],
    ['content que não é string', skillInput('a', { content: 5 })],
    ['mcp sem definition', mcpInput('a', { definition: undefined })],
    ['definition como array', mcpInput('a', { definition: [] })],
    [
      'definition com 101 chaves',
      mcpInput('a', { definition: { command: 'npx', env: wide(101) } }),
    ],
    ['aninhamento profundo', mcpInput('a', { definition: nested(7) })],
    ['string gigante na definition', mcpInput('a', { definition: { command: 'x'.repeat(5000) } })],
    ['conector sem label', mcpInput('a', { kind: 'connector' })],
  ])('saveLibraryItem recusa %s sem gravar nada', async (_name, input) => {
    const { root, handlers } = await setup();
    const result = await handlers.saveLibraryItem(input);
    expect(result.ok).toBe(false);
    expect(await exists(join(root, 'library', 'library.json'))).toBe(false);
    expect(await exists(join(root, 'library', 'skills'))).toBe(false);
  });

  test.each([
    ['chave desconhecida', { id: 'a', force: true }],
    ['id com path traversal', { id: '../x' }],
    ['id ausente', {}],
  ])('removeLibraryItem recusa %s', async (_name, input) => {
    const { handlers } = await setup();
    expect(await handlers.removeLibraryItem(input)).toEqual(INVALID);
  });

  test.each([
    ['slug inválido', { projectId: 'proj-1', itemId: 'A_b', disabled: true }],
    ['disabled não booleano', { projectId: 'proj-1', itemId: 'a', disabled: 'yes' }],
    ['projectId inseguro', { projectId: '../p', itemId: 'a', disabled: true }],
    ['chave desconhecida', { projectId: 'proj-1', itemId: 'a', disabled: true, extra: 1 }],
  ])('setProjectOverride recusa %s', async (_name, input) => {
    const { handlers } = await setup();
    expect(await handlers.setProjectOverride(input)).toEqual(INVALID);
  });

  const tooManyAccounts = Array.from({ length: 51 }, (_, index) => `acc-${index}`);
  const manyApproved = Array.from({ length: 201 }, (_, index) => `id-${index}`);

  test.each([
    ['accountIds com id inseguro', { projectId: 'proj-1', accountIds: ['../x'] }],
    ['accountIds com barra', { projectId: 'proj-1', accountIds: ['a/b'] }],
    ['accountIds acima de 50', { projectId: 'proj-1', accountIds: tooManyAccounts }],
    ['accountIds que não é array', { projectId: 'proj-1', accountIds: 'acc-claude' }],
    ['chave desconhecida', { projectId: 'proj-1', rulesSource: 'AGENTS.md' }],
  ])('previewLibrarySync recusa %s', async (_name, input) => {
    const { handlers } = await setup();
    expect(await handlers.previewLibrarySync(input)).toEqual(INVALID);
  });

  test.each([
    ['approvedIds ausente', { projectId: 'proj-1' }],
    ['approvedIds com 201 itens', { projectId: 'proj-1', approvedIds: manyApproved }],
    ['approvedIds com item vazio', { projectId: 'proj-1', approvedIds: [''] }],
    ['approvedIds com item acima de 300', { projectId: 'proj-1', approvedIds: ['x'.repeat(301)] }],
    ['approvedIds com item que não é string', { projectId: 'proj-1', approvedIds: [1] }],
    ['accountIds inseguro', { projectId: 'proj-1', approvedIds: [], accountIds: ['..'] }],
    ['rulesStrategy', { projectId: 'proj-1', approvedIds: [], rulesStrategy: 'symlink' }],
  ])('applyLibrarySync recusa %s', async (_name, input) => {
    const { handlers, run } = await setup();
    expect(await handlers.applyLibrarySync(input)).toEqual(INVALID);
    expect(run).not.toHaveBeenCalled();
  });

  test('approvedIds com exatamente 200 itens é aceito', async () => {
    const { handlers } = await setup();
    const approvedIds = Array.from({ length: 200 }, (_, index) => `id-${index}`);
    expect((await handlers.applyLibrarySync({ projectId: 'proj-1', approvedIds })).ok).toBe(true);
  });
});

describe('projeto e conta inexistentes', () => {
  test('projeto inexistente falha nos três handlers que o usam', async () => {
    const { handlers } = await setup();
    const results = await Promise.all([
      handlers.setProjectOverride({ projectId: 'ghost', itemId: 'a', disabled: true }),
      handlers.previewLibrarySync({ projectId: 'ghost' }),
      handlers.applyLibrarySync({ projectId: 'ghost', approvedIds: [] }),
    ]);
    for (const result of results) expect(messageOf(result)).toBe('Projeto não encontrado.');
  });

  test('conta inexistente em accountIds falha sem gravar nada (escolha conservadora)', async () => {
    const { handlers, account } = await setup();
    unwrap(await handlers.saveLibraryItem(skillInput('demo-skill')));
    const accountIds = [account.id, 'ghost'];
    expect(messageOf(await handlers.previewLibrarySync({ projectId: 'proj-1', accountIds }))).toBe(
      'Conta não encontrada.',
    );
    expect(
      messageOf(
        await handlers.applyLibrarySync({ projectId: 'proj-1', accountIds, approvedIds: [] }),
      ),
    ).toBe('Conta não encontrada.');
    expect(await exists(join(account.homeDir, 'skills'))).toBe(false);
  });

  test('item desligado na conta (disabledCapabilities) não é planejado nem gravado', async () => {
    const { root, handlers, account } = await setup();
    const store = await loadStore(root);
    await saveStore(root, {
      ...store,
      accounts: [{ ...account, disabledCapabilities: [{ kind: 'skill', id: 'demo-skill' }] }],
    });
    unwrap(await handlers.saveLibraryItem(skillInput('demo-skill')));
    unwrap(await handlers.saveLibraryItem(skillInput('other-skill')));
    const preview = unwrap(await handlers.previewLibrarySync({ projectId: 'proj-1' }));
    const ids = preview.items.map((item) => item.id);
    expect(ids).toContain('skill:acc-claude:other-skill');
    expect(ids).not.toContain('skill:acc-claude:demo-skill');
    unwrap(await handlers.applyLibrarySync({ projectId: 'proj-1', approvedIds: [] }));
    expect(await exists(join(account.homeDir, 'skills', 'demo-skill'))).toBe(false);
    expect(await exists(join(account.homeDir, 'skills', 'other-skill'))).toBe(true);
  });

  test('accountIds vazio não sincroniza nenhuma conta', async () => {
    const { handlers, account } = await setup();
    unwrap(await handlers.saveLibraryItem(skillInput('demo-skill')));
    const preview = unwrap(
      await handlers.previewLibrarySync({ projectId: 'proj-1', accountIds: [] }),
    );
    expect(preview.items).toEqual([]);
    unwrap(
      await handlers.applyLibrarySync({ projectId: 'proj-1', accountIds: [], approvedIds: [] }),
    );
    expect(await exists(join(account.homeDir, 'skills'))).toBe(false);
  });

  test('o limite de 200 itens desligados por projeto vira falha com mensagem', async () => {
    const { handlers } = await setup();
    for (let index = 0; index < 200; index += 1) {
      unwrap(
        await handlers.setProjectOverride({
          projectId: 'proj-1',
          itemId: `item-${index}`,
          disabled: true,
        }),
      );
    }
    const result = await handlers.setProjectOverride({
      projectId: 'proj-1',
      itemId: 'item-200',
      disabled: true,
    });
    expect(messageOf(result)).toContain('200');
    const again = await handlers.setProjectOverride({
      projectId: 'proj-1',
      itemId: 'item-0',
      disabled: true,
    });
    expect(again.ok).toBe(true);
  });
});

describe('biblioteca corrompida', () => {
  async function corrupted() {
    const scene = await setup();
    await mkdir(join(scene.root, 'library'), { recursive: true });
    await writeFile(join(scene.root, 'library', 'library.json'), '{not json');
    return scene;
  }

  test.each([
    ['listLibrary', (h: LibraryHandlers) => h.listLibrary()],
    ['saveLibraryItem', (h: LibraryHandlers) => h.saveLibraryItem(skillInput('a'))],
    ['removeLibraryItem', (h: LibraryHandlers) => h.removeLibraryItem({ id: 'a' })],
    ['previewLibrarySync', (h: LibraryHandlers) => h.previewLibrarySync({ projectId: 'proj-1' })],
    [
      'applyLibrarySync',
      (h: LibraryHandlers) => h.applyLibrarySync({ projectId: 'proj-1', approvedIds: [] }),
    ],
  ])('%s falha com a mensagem de backup e sem caminho de arquivo', async (_name, call) => {
    const { root, handlers } = await corrupted();
    const message = messageOf(await call(handlers));
    expect(message).toBe(
      `A biblioteca está corrompida. Restaure um backup em ${join(root, 'backups', 'library')}.`,
    );
    expect(message).not.toContain('library.json');
    expect(await readFile(join(root, 'library', 'library.json'), 'utf8')).toBe('{not json');
  });

  test('setProjectOverride só usa o store e continua funcionando', async () => {
    const { handlers } = await corrupted();
    const result = await handlers.setProjectOverride({
      projectId: 'proj-1',
      itemId: 'a',
      disabled: true,
    });
    expect(unwrap(result)).toEqual({ disabled: ['a'] });
  });

  test('managed.json corrompido também vira a mensagem de biblioteca corrompida', async () => {
    const { root, handlers } = await setup();
    unwrap(await handlers.saveLibraryItem(skillInput('demo-skill')));
    await writeFile(join(root, 'library', 'managed.json'), '{not json');
    const result = await handlers.previewLibrarySync({ projectId: 'proj-1' });
    expect(messageOf(result)).toContain('corrompida');
  });
});

describe('regras de salvamento', () => {
  test('mudar o kind de um id existente é recusado e nada muda', async () => {
    const { root, handlers } = await setup();
    unwrap(await handlers.saveLibraryItem(skillInput('shared')));
    const before = await readFile(join(root, 'library', 'library.json'), 'utf8');
    const result = await handlers.saveLibraryItem(mcpInput('shared'));
    expect(messageOf(result)).toBe('Já existe um item com este id de outro tipo.');
    expect(await readFile(join(root, 'library', 'library.json'), 'utf8')).toBe(before);
    expect(await exists(join(root, 'library', 'skills', 'shared', 'SKILL.md'))).toBe(true);
  });

  test('trocar mcp por skill com o mesmo id não deixa pasta de skill órfã', async () => {
    const { root, handlers } = await setup();
    unwrap(await handlers.saveLibraryItem(mcpInput('shared')));
    expect(messageOf(await handlers.saveLibraryItem(skillInput('shared')))).toContain('outro tipo');
    expect(await exists(join(root, 'library', 'skills', 'shared'))).toBe(false);
  });

  test('skill nova sem content falha e não cria pasta', async () => {
    const { root, handlers } = await setup();
    const { content: _content, ...withoutContent } = skillInput('fresh');
    const result = await handlers.saveLibraryItem(withoutContent);
    expect(result.ok).toBe(false);
    expect(await exists(join(root, 'library', 'skills', 'fresh'))).toBe(false);
    expect(unwrap(await handlers.listLibrary()).items).toEqual([]);
  });

  test.each([
    ['sem front matter', '# only a body\n'],
    ['sem description', '---\nname: demo\n---\n\nBody\n'],
    ['com segredo', `${SKILL_TEXT}\nkey: sk-${'a'.repeat(30)}\n`],
  ])(
    'skill com content inválido (%s) não deixa pasta em library/skills',
    async (_name, content) => {
      const { root, handlers } = await setup();
      const result = await handlers.saveLibraryItem(skillInput('bad-skill', { content }));
      expect(result.ok).toBe(false);
      const skills = join(root, 'library', 'skills');
      const entries = (await exists(skills)) ? await readdir(skills) : [];
      expect(entries).toEqual([]);
      expect(unwrap(await handlers.listLibrary()).items).toEqual([]);
    },
  );

  test('item inválido com content válido não grava a pasta da skill', async () => {
    const { root, handlers } = await setup();
    const result = await handlers.saveLibraryItem(skillInput('half-done', { name: '' }));
    expect(result.ok).toBe(false);
    expect(await exists(join(root, 'library', 'skills', 'half-done'))).toBe(false);
  });

  test('editar uma skill sem content reaproveita o hash e o conteúdo', async () => {
    const { root, handlers } = await setup();
    const first = unwrap(await handlers.saveLibraryItem(skillInput('keep')));
    const { content: _content, ...withoutContent } = skillInput('keep', { name: 'Renamed' });
    const second = unwrap(await handlers.saveLibraryItem(withoutContent));
    expect(second.name).toBe('Renamed');
    expect(second.definition).toEqual(first.definition);
    expect(await readFile(join(root, 'library', 'skills', 'keep', 'SKILL.md'), 'utf8')).toBe(
      SKILL_TEXT,
    );
  });

  test('o item salvo tem source created e updatedAt', async () => {
    const { handlers } = await setup();
    const saved = unwrap(await handlers.saveLibraryItem(mcpInput('plain')));
    expect(saved.source).toBe('created');
    expect(Number.isNaN(Date.parse(saved.updatedAt))).toBe(false);
  });

  test('remover um id inexistente devolve removed false', async () => {
    const { handlers } = await setup();
    expect(unwrap(await handlers.removeLibraryItem({ id: 'ghost' }))).toEqual({ removed: false });
  });

  test('20 saveLibraryItem concorrentes não perdem itens', async () => {
    const { handlers } = await setup();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        handlers.saveLibraryItem(
          index % 2 === 0 ? mcpInput(`m-${index}`) : skillInput(`s-${index}`),
        ),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const ids = unwrap(await handlers.listLibrary()).items.map((item) => item.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  test('saves e applies concorrentes terminam sem perder itens', async () => {
    const { handlers } = await setup();
    const work = Array.from({ length: 6 }, (_, index) => [
      handlers.saveLibraryItem(skillInput(`s-${index}`)),
      handlers.applyLibrarySync({ projectId: 'proj-1', approvedIds: [] }),
    ]).flat();
    const results = await Promise.all(work);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(unwrap(await handlers.listLibrary()).items).toHaveLength(6);
  });
});

describe('pluginRecipes', () => {
  test('há uma receita por item plugin e nenhuma para os outros kinds', async () => {
    const { handlers } = await setup();
    unwrap(await handlers.saveLibraryItem(mcpInput('an-mcp')));
    unwrap(
      await handlers.saveLibraryItem({
        id: 'good-plugin',
        name: 'Good',
        description: null,
        enabled: true,
        kind: 'plugin',
        definition: { provider: 'claude', marketplace: 'market', name: 'tool' },
      }),
    );
    const listing = unwrap(await handlers.listLibrary());
    expect(Object.keys(listing.pluginRecipes)).toEqual(['good-plugin']);
    expect(listing.pluginRecipes['good-plugin']).toEqual({
      ok: true,
      commandId: 'claude.plugin.install',
      params: { name: 'tool', marketplace: 'market' },
    });
  });

  test('provider sem suporte traz ok false com o motivo', async () => {
    const { handlers } = await setup();
    unwrap(
      await handlers.saveLibraryItem({
        id: 'qwen-plugin',
        name: 'Q',
        description: null,
        enabled: true,
        kind: 'plugin',
        definition: { provider: 'qwen', name: 'tool' },
      }),
    );
    const recipe = unwrap(await handlers.listLibrary()).pluginRecipes['qwen-plugin'];
    expect(recipe).toEqual({ ok: false, reason: 'Qwen usa extensões, não plugins.' });
  });

  test('plugin com provider desconhecido é recusado pelo core', async () => {
    const { handlers } = await setup();
    const result = await handlers.saveLibraryItem({
      id: 'odd-plugin',
      name: 'Odd',
      description: null,
      enabled: true,
      kind: 'plugin',
      definition: { provider: 'nope', name: 'tool' },
    });
    expect(result.ok).toBe(false);
  });
});

describe('prototype pollution e segredos', () => {
  const polluted = (): unknown => (Object.prototype as Record<string, unknown>)['polluted'];

  test('__proto__ como chave de env é recusado e não polui Object.prototype', async () => {
    const { root, handlers } = await setup();
    const definition: unknown = JSON.parse('{"command":"npx","env":{"__proto__":"${X}"}}');
    const result = await handlers.saveLibraryItem(mcpInput('proto', { definition }));
    expect(result.ok).toBe(false);
    expect(polluted()).toBeUndefined();
    expect(await exists(join(root, 'library', 'library.json'))).toBe(false);
  });

  test('constructor como chave de header é recusado', async () => {
    const { handlers } = await setup();
    const definition: unknown = JSON.parse(
      '{"type":"http","url":"https://x.dev/mcp","headers":{"constructor":"${X}"}}',
    );
    const result = await handlers.saveLibraryItem(
      mcpInput('ctor', { kind: 'connector', label: 'C', definition }),
    );
    expect(result.ok).toBe(false);
  });

  test('__proto__ no topo da definition não é propagado para o item salvo', async () => {
    const { handlers } = await setup();
    const definition: unknown = JSON.parse('{"command":"npx","__proto__":{"polluted":true}}');
    const saved = unwrap(await handlers.saveLibraryItem(mcpInput('top', { definition })));
    expect(saved.definition).toEqual({ command: 'npx' });
    expect(polluted()).toBeUndefined();
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  test('a mensagem de recusa cita a chave e nunca o valor do segredo', async () => {
    const { handlers } = await setup();
    const result = await handlers.saveLibraryItem(
      mcpInput('secret', {
        definition: { command: 'npx', env: { API_TOKEN: 'plain-secret-9876' } },
      }),
    );
    const message = messageOf(result);
    expect(message).toContain('API_TOKEN');
    expect(message).not.toContain('plain-secret-9876');
  });

  test('o store e a listagem nunca contêm o valor recusado', async () => {
    const { root, handlers } = await setup();
    await handlers.saveLibraryItem(
      mcpInput('secret', {
        definition: { command: 'npx', env: { API_TOKEN: 'plain-secret-9876' } },
      }),
    );
    expect(JSON.stringify(unwrap(await handlers.listLibrary()))).not.toContain('plain-secret-9876');
    expect(JSON.stringify(await loadStore(root))).not.toContain('plain-secret-9876');
  });
});

describe('a aprovação vale só para o estado mostrado no preview', () => {
  async function previewedUpdate() {
    const context = await setup();
    const target = join(context.account.homeDir, '.claude.json');
    await writeFile(target, JSON.stringify({ mcpServers: {} }));
    unwrap(await context.handlers.saveLibraryItem(mcpInput('demo-mcp')));
    const result = unwrap(await context.handlers.previewLibrarySync({ projectId: 'proj-1' }));
    const item = result.items.find((entry) => entry.id === 'mcp:acc-claude');
    expect(item?.status).toBe('update');
    return { ...context, target, key: item?.approvalKey ?? '' };
  }

  test('o id puro não aprova e a chave do preview aprova', async () => {
    const { handlers, target, key } = await previewedUpdate();
    const apply = (approvedIds: string[]) =>
      handlers.applyLibrarySync({ projectId: 'proj-1', approvedIds });

    expect(unwrap(await apply(['mcp:acc-claude'])).skippedIds).toEqual(['mcp:acc-claude']);
    expect(await readFile(target, 'utf8')).not.toContain('demo-mcp');
    expect(unwrap(await apply([key])).appliedIds).toEqual(['mcp:acc-claude']);
    expect(await readFile(target, 'utf8')).toContain('demo-mcp');
  });

  test('um alvo alterado depois do preview é pulado', async () => {
    const { handlers, target, key } = await previewedUpdate();
    const userOwn = JSON.stringify({ mcpServers: { 'demo-mcp': { command: 'mine' } } });
    await writeFile(target, userOwn);

    const result = unwrap(
      await handlers.applyLibrarySync({ projectId: 'proj-1', approvedIds: [key] }),
    );

    expect(result.skippedIds).toEqual(['mcp:acc-claude']);
    expect(await readFile(target, 'utf8')).toBe(userOwn);
  });
});
