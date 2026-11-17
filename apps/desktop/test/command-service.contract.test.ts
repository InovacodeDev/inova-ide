import { describe, expect, test, vi } from 'vitest';
import { createCommandService } from '../src/main/command-service.js';
import { COMMANDS, isSafeToken } from '../src/main/ide-commands.js';
import type { CommandSpec } from '../src/main/ide-commands.js';

const projectSpec: CommandSpec = {
  id: 'test.project',
  binary: 'tool',
  parseArgs: () => ['go'],
  cwd: 'project',
  mode: 'exec',
  mutating: true,
  timeoutMs: 1000,
  maxOutputBytes: 100,
};

function setup(
  registry: Record<string, CommandSpec> = { ...COMMANDS, 'test.project': projectSpec },
) {
  const projectPath = vi.fn(async (id: string) => (id === 'p1' ? '/repos/app' : undefined));
  const service = createCommandService({
    projectPath,
    ideRoot: '/data/inova',
    neutralCwd: '/home/user',
    registry,
  });
  return { projectPath, service };
}

describe('regra 1: commandId fora do registro é recusado', () => {
  test('um id desconhecido não resolve para nenhum processo', async () => {
    const { service } = setup();
    expect((await service.resolve({ commandId: 'rm.everything' })).ok).toBe(false);
  });

  test('comandos do registro resolvem', async () => {
    const { service } = setup();
    expect(await service.resolve({ commandId: 'gh.version' })).toMatchObject({
      ok: true,
      value: { binary: 'gh', args: ['--version'], mutating: false },
    });
  });
});

describe('regra 2: params inválidos são recusados antes de criar processo', () => {
  test.each([
    ['nome com ponto e vírgula', { name: 'x; rm -rf /' }],
    ['nome começando com hífen', { name: '--exec=evil' }],
    ['campo extra', { name: 'gh-foo', extra: 1 }],
    ['nome e all juntos', { name: 'gh-foo', all: true }],
    ['tipo errado', { name: 42 }],
    ['sem params', undefined],
  ])('gh.extension.upgrade recusa %s', async (_label, params) => {
    const { service } = setup();
    expect((await service.resolve({ commandId: 'gh.extension.upgrade', params })).ok).toBe(false);
  });

  test('gh.version recusa params não vazios', async () => {
    const { service } = setup();
    expect((await service.resolve({ commandId: 'gh.version', params: { extra: 'x' } })).ok).toBe(
      false,
    );
  });
});

describe('regra 3: texto livre do renderer nunca chega a um shell', () => {
  test('o argv é montado pelo registro e o binário vem do registro', async () => {
    const { service } = setup();
    const result = await service.resolve({
      commandId: 'gh.extension.upgrade',
      params: { name: 'owner/gh-foo' },
      projectId: 'p1',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { binary: 'gh', args: ['extension', 'upgrade', 'owner/gh-foo'], mutating: true },
    });
  });

  test('nenhum comando do registro usa shell como binário', () => {
    const shells = ['sh', 'bash', 'zsh', 'fish', 'dash', 'cmd', 'cmd.exe', 'powershell', 'pwsh'];
    for (const spec of Object.values(COMMANDS)) {
      expect(shells).not.toContain(spec.binary);
      expect(spec.id).toMatch(/^[a-z0-9]+(?:\.[a-z0-9]+)+$/);
    }
  });

  test.each([
    '$(whoami)',
    '`id`',
    'a b',
    'a\nb',
    'a&b',
    'a|b',
    'a>b',
    '%PATH%',
    '-rf',
    '../etc/passwd',
    '',
    'x'.repeat(101),
  ])('isSafeToken recusa %j', (value) => {
    expect(isSafeToken(value)).toBe(false);
  });

  test.each(['gh-foo', 'owner/gh-foo', 'v1.2.3'])('isSafeToken aceita %s', (value) => {
    expect(isSafeToken(value)).toBe(true);
  });
});

describe('regra 8: cwd project com projeto desconhecido é recusado', () => {
  test('projeto desconhecido é recusado', async () => {
    const { service } = setup();
    expect((await service.resolve({ commandId: 'test.project', projectId: 'ghost' })).ok).toBe(
      false,
    );
  });

  test('sem projectId é recusado', async () => {
    const { service } = setup();
    expect((await service.resolve({ commandId: 'test.project' })).ok).toBe(false);
  });

  test('o cwd vem do store, nunca do renderer', async () => {
    const { service } = setup();
    const result = await service.resolve({
      commandId: 'test.project',
      projectId: 'p1',
      params: { cwd: '/etc' },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { cwd: '/repos/app', queueKey: 'project:p1' },
    });
  });
});
