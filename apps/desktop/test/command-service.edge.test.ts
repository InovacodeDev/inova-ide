import { describe, expect, test, vi } from 'vitest';
import { createCommandService } from '../src/main/command-service.js';
import { COMMANDS } from '../src/main/ide-commands.js';
import type { CommandSpec } from '../src/main/ide-commands.js';

const ideRootSpec: CommandSpec = {
  id: 'test.ide',
  binary: 'tool',
  parseArgs: () => [],
  cwd: 'ide-root',
  mode: 'exec',
  mutating: false,
  timeoutMs: 1000,
  maxOutputBytes: 100,
};

function setup() {
  const projectPath = vi.fn(async () => '/repos/app');
  const service = createCommandService({
    projectPath,
    ideRoot: '/data/inova',
    neutralCwd: '/home/user',
    registry: { ...COMMANDS, 'test.ide': ideRootSpec },
  });
  return { projectPath, service };
}

describe('commandId hostil', () => {
  test.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])(
    'chaves do protótipo (%s) não são comandos',
    async (commandId) => {
      const { service } = setup();
      expect((await service.resolve({ commandId })).ok).toBe(false);
    },
  );

  test.each([undefined, null, 42, {}, [], '', 'x'.repeat(300)])(
    'commandId %j é recusado',
    async (commandId) => {
      const { service } = setup();
      expect((await service.resolve({ commandId })).ok).toBe(false);
    },
  );

  test('entrada que não é objeto é recusada', async () => {
    const { service } = setup();
    expect((await service.resolve(null as never)).ok).toBe(false);
    expect((await service.resolve('gh.version' as never)).ok).toBe(false);
  });
});

describe('params hostis', () => {
  test.each([null, 'texto', 42, [], ['name']])(
    'gh.extension.upgrade recusa params %j',
    async (params) => {
      const { service } = setup();
      expect((await service.resolve({ commandId: 'gh.extension.upgrade', params })).ok).toBe(false);
    },
  );

  test('all precisa ser exatamente true', async () => {
    const { service } = setup();
    expect(
      (await service.resolve({ commandId: 'gh.extension.upgrade', params: { all: 'true' } })).ok,
    ).toBe(false);
    expect(
      await service.resolve({ commandId: 'gh.extension.upgrade', params: { all: true } }),
    ).toMatchObject({ ok: true, value: { args: ['extension', 'upgrade', '--all'] } });
  });

  test('params aceitos null/undefined/{} para comando sem parâmetros', async () => {
    const { service } = setup();
    for (const params of [undefined, null, {}]) {
      expect((await service.resolve({ commandId: 'gh.version', params })).ok).toBe(true);
    }
  });
});

describe('cwd e fila', () => {
  test('cwd ide-root usa a raiz da IDE; none usa o cwd neutro', async () => {
    const { service } = setup();
    expect(await service.resolve({ commandId: 'test.ide' })).toMatchObject({
      value: { cwd: '/data/inova', queueKey: 'global' },
    });
    expect(await service.resolve({ commandId: 'gh.version' })).toMatchObject({
      value: { cwd: '/home/user', queueKey: 'global' },
    });
  });

  test('projectId é ignorado e não consulta o store quando o cwd não é project', async () => {
    const { service, projectPath } = setup();
    await service.resolve({ commandId: 'gh.version', projectId: 'p1' });
    expect(projectPath).not.toHaveBeenCalled();
  });

  test('projectId fora do limite ou de tipo errado é recusado sem consultar o store', async () => {
    const registry = {
      p: { ...ideRootSpec, id: 'p', cwd: 'project' as const },
    };
    const projectPath = vi.fn(async () => '/x');
    const service = createCommandService({
      projectPath,
      ideRoot: '/i',
      neutralCwd: '/n',
      registry,
    });
    for (const projectId of [42, '', 'x'.repeat(300), {}]) {
      expect((await service.resolve({ commandId: 'p', projectId })).ok).toBe(false);
    }
    expect(projectPath).not.toHaveBeenCalled();
  });
});
