import { describe, expect, test, vi } from 'vitest';
import { createCommandService } from '../src/main/command-service.js';
import type { CommandServiceDeps } from '../src/main/command-service.js';

const CLAUDE_ENV = { CLAUDE_CONFIG_DIR: '/accounts/claude-a' };
const CLAUDE_UNSET = ['ANTHROPIC_API_KEY'];

function setup() {
  const accountEnv = vi.fn<NonNullable<CommandServiceDeps['accountEnv']>>(
    async (accountId, provider) =>
      accountId === 'acc-claude' && provider === 'claude'
        ? { env: CLAUDE_ENV, unsetEnv: CLAUDE_UNSET }
        : undefined,
  );
  const service = createCommandService({
    projectPath: async () => undefined,
    accountEnv,
    ideRoot: '/data/inova',
    neutralCwd: '/home/user',
  });
  return { accountEnv, service };
}

const install = {
  commandId: 'claude.plugin.install',
  params: { name: 'code-simplifier', marketplace: 'claude-plugins-official' },
};

describe('plugin por receita vira comando mutante com a conta', () => {
  test('claude.plugin.install monta o argv e o env da conta', async () => {
    const { service, accountEnv } = setup();
    const result = await service.resolve({ ...install, accountId: 'acc-claude' });
    expect(result).toMatchObject({
      ok: true,
      value: {
        commandId: 'claude.plugin.install',
        binary: 'claude',
        args: ['plugin', 'install', 'code-simplifier@claude-plugins-official'],
        mutating: true,
        mode: 'exec',
        env: CLAUDE_ENV,
        unsetEnv: CLAUDE_UNSET,
      },
    });
    expect(accountEnv).toHaveBeenCalledWith('acc-claude', 'claude');
  });

  test.each([
    ['codex.plugin.add', 'codex', ['plugin', 'add', 'p@m'], 'codex'],
    ['agy.plugin.install', 'agy', ['plugin', 'install', 'p@m'], 'gemini'],
  ] as const)('%s usa o binário %s e o provider %s', async (commandId, binary, args, provider) => {
    const accountEnv = vi.fn(async () => ({ env: { HOME_X: '/h' }, unsetEnv: [] }));
    const service = createCommandService({
      projectPath: async () => undefined,
      accountEnv,
      ideRoot: '/data/inova',
      neutralCwd: '/home/user',
    });
    const result = await service.resolve({
      commandId,
      params: { name: 'p', marketplace: 'm' },
      accountId: 'a1',
    });
    expect(result).toMatchObject({ ok: true, value: { binary, args: [...args], mutating: true } });
    expect(accountEnv).toHaveBeenCalledWith('a1', provider);
  });

  test('sem marketplace o argv leva só o nome', async () => {
    const { service } = setup();
    const result = await service.resolve({
      commandId: 'claude.plugin.install',
      params: { name: 'code-simplifier' },
      accountId: 'acc-claude',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { args: ['plugin', 'install', 'code-simplifier'] },
    });
  });

  test('sem accountId o comando falha', async () => {
    const { service, accountEnv } = setup();
    expect((await service.resolve(install)).ok).toBe(false);
    expect(accountEnv).not.toHaveBeenCalled();
  });

  test('conta de outro provider ou inexistente falha', async () => {
    const { service } = setup();
    const result = await service.resolve({
      commandId: 'codex.plugin.add',
      params: { name: 'p' },
      accountId: 'acc-claude',
    });
    expect(result).toEqual({ ok: false, message: 'Conta não encontrada.' });
    expect((await service.resolve({ ...install, accountId: 'nao-existe' })).ok).toBe(false);
  });

  test('o argv nunca contém -y nem --yes', async () => {
    const { service } = setup();
    const result = await service.resolve({ ...install, accountId: 'acc-claude' });
    if (!result.ok) throw new Error('resolve falhou');
    expect(result.value.args).not.toContain('-y');
    expect(result.value.args).not.toContain('--yes');
  });

  test('a fila é por conta', async () => {
    const { service } = setup();
    const result = await service.resolve({ ...install, accountId: 'acc-claude' });
    expect(result).toMatchObject({ ok: true, value: { queueKey: 'account:acc-claude' } });
  });
});
