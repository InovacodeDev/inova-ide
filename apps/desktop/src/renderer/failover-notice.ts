import type { ProviderId } from '@inova/core/types';
import type { AccountView } from '../shared/api';
import { accountDisplayName, PROVIDER_NAME } from './provider-meta';

export interface FailoverNotice {
  fromAccountId: string | null;
  fromProvider: ProviderId | null;
  fromLabel: string | null;
  fromDisplay: string;
  toAccountId: string | null;
  toProvider: ProviderId | null;
  toDisplay: string;
  rollbackLastTurn: boolean;
}

export interface FailoverBannerCopy {
  message: string;
  acceptLabel: string;
  acceptTooltip: string;
  revertLabel: string | null;
  revertTooltip: string | null;
}

function formatAccountBadge(account: AccountView | undefined, fallback: string): string {
  if (!account) return fallback;
  return `${PROVIDER_NAME[account.provider]} (${accountDisplayName(account)})`;
}

export function buildFailoverNotice(input: {
  fromAccount: AccountView | undefined;
  toAccount: AccountView | undefined;
  rollbackLastTurn: boolean;
}): FailoverNotice {
  const { fromAccount, toAccount, rollbackLastTurn } = input;
  return {
    fromAccountId: fromAccount?.id ?? null,
    fromProvider: fromAccount?.provider ?? null,
    fromLabel: fromAccount ? accountDisplayName(fromAccount) : null,
    fromDisplay: formatAccountBadge(fromAccount, 'a conta anterior'),
    toAccountId: toAccount?.id ?? null,
    toProvider: toAccount?.provider ?? null,
    toDisplay: formatAccountBadge(toAccount, 'a nova conta'),
    rollbackLastTurn,
  };
}

export function describeFailoverBanner(notice: FailoverNotice): FailoverBannerCopy {
  const providerChanged =
    notice.fromProvider !== null &&
    notice.toProvider !== null &&
    notice.fromProvider !== notice.toProvider;
  const turnSuffix = notice.rollbackLastTurn ? ' e o turno atual foi retomado nela' : '';

  if (providerChanged && notice.fromProvider !== null && notice.toProvider !== null) {
    const fromName = PROVIDER_NAME[notice.fromProvider];
    const toName = PROVIDER_NAME[notice.toProvider];
    return {
      message: `Limite atingido em ${notice.fromDisplay}. A sessão migrou automaticamente para ${notice.toDisplay}${turnSuffix}.`,
      acceptLabel: `Continuar com ${toName}`,
      acceptTooltip: `Manter a sessão usando ${notice.toDisplay}`,
      revertLabel: notice.fromAccountId ? `Voltar para ${fromName}` : null,
      revertTooltip: notice.fromAccountId ? `Retornar a sessão para ${notice.fromDisplay}` : null,
    };
  }

  return {
    message: `Limite atingido em ${notice.fromDisplay}. A sessão mudou para ${notice.toDisplay}${turnSuffix}.`,
    acceptLabel: 'Continuar nesta conta',
    acceptTooltip: `Manter a sessão usando ${notice.toDisplay}`,
    revertLabel:
      notice.fromAccountId && notice.fromLabel ? `Voltar para ${notice.fromLabel}` : null,
    revertTooltip: notice.fromAccountId ? `Retornar a sessão para ${notice.fromDisplay}` : null,
  };
}
