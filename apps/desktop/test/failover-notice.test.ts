import { describe, expect, test } from 'vitest';
import type { AccountView } from '../src/shared/api';
import { buildFailoverNotice, describeFailoverBanner } from '../src/renderer/failover-notice';

function account(overrides: Partial<AccountView>): AccountView {
  return {
    id: 'acc-1',
    label: 'pessoal',
    provider: 'claude',
    status: 'logged-in',
    email: null,
    ...overrides,
  };
}

describe('failover-notice', () => {
  test('describes cross-provider migration with provider-specific buttons', () => {
    const notice = buildFailoverNotice({
      fromAccount: account({ id: 'a1', provider: 'claude', label: 'pessoal' }),
      toAccount: account({ id: 'a2', provider: 'codex', label: 'trabalho' }),
      rollbackLastTurn: true,
    });
    const banner = describeFailoverBanner(notice);

    expect(banner.message).toBe(
      'Limite atingido em Claude (pessoal). A sessão migrou automaticamente para Codex (trabalho) e o turno atual foi retomado nela.',
    );
    expect(banner.acceptLabel).toBe('Continuar com Codex');
    expect(banner.revertLabel).toBe('Voltar para Claude');
  });

  test('describes same-provider account switch with account-specific revert label', () => {
    const notice = buildFailoverNotice({
      fromAccount: account({
        id: 'a1',
        provider: 'claude',
        label: 'pessoal',
        email: 'a@inova.dev',
      }),
      toAccount: account({ id: 'a2', provider: 'claude', label: 'trabalho' }),
      rollbackLastTurn: false,
    });
    const banner = describeFailoverBanner(notice);

    expect(banner.message).toBe(
      'Limite atingido em Claude (a@inova.dev). A sessão mudou para Claude (trabalho).',
    );
    expect(banner.acceptLabel).toBe('Continuar nesta conta');
    expect(banner.revertLabel).toBe('Voltar para a@inova.dev');
  });

  test('omits revert action when source account is unavailable', () => {
    const notice = buildFailoverNotice({
      fromAccount: undefined,
      toAccount: account({ id: 'a2', provider: 'gemini', label: 'backup' }),
      rollbackLastTurn: false,
    });
    const banner = describeFailoverBanner(notice);

    expect(banner.acceptLabel).toBe('Continuar nesta conta');
    expect(banner.revertLabel).toBeNull();
    expect(banner.revertTooltip).toBeNull();
  });
});
