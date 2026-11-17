import { describe, expect, test, vi } from 'vitest';
import { createCommandService } from '../src/main/command-service.js';
import type { CommandServiceDeps } from '../src/main/command-service.js';
import { parseRunCommand } from '../src/main/validation.js';
import { microtasks, request, setup as setupExecutor } from './command-executor-fixtures.js';

function setup() {
  const accountEnv = vi.fn<NonNullable<CommandServiceDeps['accountEnv']>>(async () => ({
    env: { CLAUDE_CONFIG_DIR: '/accounts/a' },
    unsetEnv: [],
  }));
  const service = createCommandService({
    projectPath: async () => undefined,
    accountEnv,
    ideRoot: '/data/inova',
    neutralCwd: '/home/user',
  });
  return { accountEnv, service };
}

const resolve = (params: unknown, accountId: unknown = 'acc') =>
  setup().service.resolve({ commandId: 'claude.plugin.install', params, accountId });

describe('params de plugin inválidos são recusados', () => {
  test.each([
    ['chave extra', { name: 'x', marketplace: 'm', extra: 1 }],
    ['só chave extra', { name: 'x', other: 'y' }],
    ['sem name', { marketplace: 'm' }],
    ['name com hífen inicial', { name: '-y' }],
    ['name com --yes', { name: '--yes' }],
    ['marketplace com hífen inicial', { name: 'x', marketplace: '-m' }],
    ['marketplace com barra', { name: 'x', marketplace: 'a/b' }],
    ['name com barra', { name: 'a/b' }],
    ['name com arroba', { name: 'a@b' }],
    ['name vazio', { name: '' }],
    ['name numérico', { name: 1 }],
    ['marketplace nulo', { name: 'x', marketplace: null }],
    ['name com 101 caracteres', { name: 'a'.repeat(101) }],
    ['params ausente', undefined],
    ['params array', ['x']],
  ])('%s', async (_label, params) => {
    expect((await resolve(params)).ok).toBe(false);
  });

  test('a falha de params ocorre antes de consultar a conta', async () => {
    const { service, accountEnv } = setup();
    await service.resolve({
      commandId: 'claude.plugin.install',
      params: { name: '-y' },
      accountId: 'acc',
    });
    expect(accountEnv).not.toHaveBeenCalled();
  });
});

describe('accountId', () => {
  test.each([[42], [null], [{}], [''], ['a'.repeat(256)]])('%j é recusado', async (accountId) => {
    expect((await resolve({ name: 'x' }, accountId)).ok).toBe(false);
  });

  test('sem accountEnv configurado o comando com conta falha', async () => {
    const service = createCommandService({
      projectPath: async () => undefined,
      ideRoot: '/data/inova',
      neutralCwd: '/home/user',
    });
    const result = await service.resolve({
      commandId: 'claude.plugin.install',
      params: { name: 'x' },
      accountId: 'acc',
    });
    expect(result.ok).toBe(false);
  });

  test('comando sem account ignora accountId e não recebe env', async () => {
    const { service, accountEnv } = setup();
    const result = await service.resolve({ commandId: 'gh.version', accountId: 'acc' });
    expect(accountEnv).not.toHaveBeenCalled();
    if (!result.ok) throw new Error('resolve falhou');
    expect(result.value).not.toHaveProperty('env');
    expect(result.value.queueKey).toBe('global');
  });

  test('parseRunCommand aceita accountId string e recusa outros tipos', () => {
    expect(parseRunCommand({ commandId: 'c', accountId: 'acc' })).toEqual({
      commandId: 'c',
      accountId: 'acc',
    });
    expect(parseRunCommand({ commandId: 'c' })).toEqual({ commandId: 'c' });
    expect(parseRunCommand({ commandId: 'c', accountId: 7 })).toBeUndefined();
    expect(parseRunCommand({ commandId: 'c', accountId: '../x' })).toBeUndefined();
  });
});

describe('env da conta no executor', () => {
  test('request.env chega ao processo e não sobrescreve EXEC_ENV', async () => {
    const { executor, spawnChild } = setupExecutor();
    await executor.run(
      request({
        env: { CLAUDE_CONFIG_DIR: '/accounts/a', NO_COLOR: '0', GIT_TERMINAL_PROMPT: '1' },
      }),
    );
    await microtasks();
    const env = spawnChild.mock.calls[0]?.[0].env;
    expect(env).toMatchObject({
      PATH: '/bin',
      CLAUDE_CONFIG_DIR: '/accounts/a',
      NO_COLOR: '1',
      GIT_TERMINAL_PROMPT: '0',
    });
  });

  test('request.env vence o env base nas chaves que não são de EXEC_ENV', async () => {
    const { executor, spawnChild } = setupExecutor({
      env: async () => ({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/real' }),
    });
    await executor.run(request({ env: { CLAUDE_CONFIG_DIR: '/accounts/a' } }));
    await microtasks();
    expect(spawnChild.mock.calls[0]?.[0].env?.['CLAUDE_CONFIG_DIR']).toBe('/accounts/a');
  });

  test('sem request.env o env base segue intacto', async () => {
    const { executor, spawnChild } = setupExecutor();
    await executor.run(request());
    await microtasks();
    expect(spawnChild.mock.calls[0]?.[0].env).toMatchObject({ PATH: '/bin', NO_COLOR: '1' });
  });
});
