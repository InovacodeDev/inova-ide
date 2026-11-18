import { describe, expect, test } from 'vitest';
import { createCommandService } from '../src/main/command-service.js';
import { microtasks, request, setup, setupPty } from './command-executor-fixtures.js';

const BASE_ENV = {
  PATH: '/bin',
  ANTHROPIC_API_KEY: 'sk-base-key',
  OPENAI_API_KEY: 'sk-openai-key',
  CLAUDE_CONFIG_DIR: '/real',
};
const baseEnv = async () => BASE_ENV;

describe('env da conta: variáveis removidas do env base', () => {
  test('exec: unsetEnv remove a chave do base e o processo filho não a recebe', async () => {
    const { executor, spawnChild } = setup({ env: baseEnv });
    await executor.run(
      request({
        env: { CLAUDE_CONFIG_DIR: '/accounts/a' },
        unsetEnv: ['ANTHROPIC_API_KEY'],
      }),
    );
    await microtasks();
    const env = spawnChild.mock.calls[0]?.[0].env;
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).toMatchObject({
      PATH: '/bin',
      OPENAI_API_KEY: 'sk-openai-key',
      CLAUDE_CONFIG_DIR: '/accounts/a',
    });
  });

  test('pty: unsetEnv também vale', async () => {
    const { executor, spawnPty } = setupPty({ env: baseEnv });
    await executor.run(request({ mode: 'pty', unsetEnv: ['ANTHROPIC_API_KEY'] }));
    await microtasks();
    const env = spawnPty.mock.calls[0]?.[0].env;
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).toMatchObject({ PATH: '/bin', OPENAI_API_KEY: 'sk-openai-key' });
  });

  test('sem unsetEnv o env base segue intacto', async () => {
    const { executor, spawnChild } = setup({ env: baseEnv });
    await executor.run(request());
    await microtasks();
    expect(spawnChild.mock.calls[0]?.[0].env).toMatchObject(BASE_ENV);
  });

  test('request.env e EXEC_ENV vencem unsetEnv', async () => {
    const { executor, spawnChild } = setup({ env: baseEnv });
    await executor.run(
      request({
        env: { ANTHROPIC_API_KEY: 'da-conta' },
        unsetEnv: ['ANTHROPIC_API_KEY', 'NO_COLOR'],
      }),
    );
    await microtasks();
    expect(spawnChild.mock.calls[0]?.[0].env).toMatchObject({
      ANTHROPIC_API_KEY: 'da-conta',
      NO_COLOR: '1',
    });
  });

  test('unsetEnv não altera o objeto de env compartilhado', async () => {
    const { executor } = setup({ env: baseEnv });
    await executor.run(request({ unsetEnv: ['ANTHROPIC_API_KEY'] }));
    await microtasks();
    expect(BASE_ENV).toHaveProperty('ANTHROPIC_API_KEY', 'sk-base-key');
  });
});

describe('serviço repassa unsetEnv ao pedido', () => {
  function serviceWith(unsetEnv: readonly string[]) {
    return createCommandService({
      projectPath: async () => undefined,
      accountEnv: async () => ({ env: { CLAUDE_CONFIG_DIR: '/accounts/a' }, unsetEnv }),
      ideRoot: '/data/inova',
      neutralCwd: '/home/user',
    });
  }

  test('comando de plugin leva env e unsetEnv da conta', async () => {
    const result = await serviceWith(['ANTHROPIC_API_KEY']).resolve({
      commandId: 'claude.plugin.install',
      params: { name: 'x' },
      accountId: 'acc',
    });
    if (!result.ok) throw new Error('resolve falhou');
    expect(result.value.env).toEqual({ CLAUDE_CONFIG_DIR: '/accounts/a' });
    expect(result.value.unsetEnv).toEqual(['ANTHROPIC_API_KEY']);
  });

  test('comando sem account não leva unsetEnv', async () => {
    const result = await serviceWith(['ANTHROPIC_API_KEY']).resolve({
      commandId: 'gh.version',
      accountId: 'acc',
    });
    if (!result.ok) throw new Error('resolve falhou');
    expect(result.value).not.toHaveProperty('unsetEnv');
    expect(result.value).not.toHaveProperty('env');
  });
});
