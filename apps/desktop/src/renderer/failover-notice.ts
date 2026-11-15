import type { ProviderId, SupportedLocale } from '@inova/core/types';
import type { AccountView } from '../shared/api';
import { translate } from './i18n';
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
  locale?: SupportedLocale;
}): FailoverNotice {
  const { fromAccount, toAccount, rollbackLastTurn } = input;
  const locale = input.locale ?? 'pt-BR';
  return {
    fromAccountId: fromAccount?.id ?? null,
    fromProvider: fromAccount?.provider ?? null,
    fromLabel: fromAccount ? accountDisplayName(fromAccount) : null,
    fromDisplay: formatAccountBadge(fromAccount, translate(locale, 'failover.prevAccountFallback')),
    toAccountId: toAccount?.id ?? null,
    toProvider: toAccount?.provider ?? null,
    toDisplay: formatAccountBadge(toAccount, translate(locale, 'failover.nextAccountFallback')),
    rollbackLastTurn,
  };
}

export function describeFailoverBanner(
  notice: FailoverNotice,
  locale: SupportedLocale = 'pt-BR',
): FailoverBannerCopy {
  const providerChanged =
    notice.fromProvider !== null &&
    notice.toProvider !== null &&
    notice.fromProvider !== notice.toProvider;
  const turnSuffix = notice.rollbackLastTurn ? translate(locale, 'failover.rollbackSuffix') : '';

  if (providerChanged && notice.fromProvider !== null && notice.toProvider !== null) {
    const fromName = PROVIDER_NAME[notice.fromProvider];
    const toName = PROVIDER_NAME[notice.toProvider];
    return {
      message: translate(locale, 'failover.providerMsg', {
        fromDisplay: notice.fromDisplay,
        toDisplay: notice.toDisplay,
        turnSuffix,
      }),
      acceptLabel: translate(locale, 'failover.acceptProviderBtn', { provider: toName }),
      acceptTooltip: translate(locale, 'failover.acceptAccountTooltip', {
        toDisplay: notice.toDisplay,
      }),
      revertLabel: notice.fromAccountId
        ? translate(locale, 'failover.returnAccountBtn', { label: fromName })
        : null,
      revertTooltip: notice.fromAccountId
        ? translate(locale, 'failover.returnTooltip', {
            from: '',
            fromAccount: notice.fromDisplay,
          }).trim()
        : null,
    };
  }

  return {
    message: translate(locale, 'failover.accountMsg', {
      fromDisplay: notice.fromDisplay,
      toDisplay: notice.toDisplay,
      turnSuffix,
    }),
    acceptLabel: translate(locale, 'failover.acceptAccountBtn'),
    acceptTooltip: translate(locale, 'failover.acceptAccountTooltip', {
      toDisplay: notice.toDisplay,
    }),
    revertLabel:
      notice.fromAccountId && notice.fromLabel
        ? translate(locale, 'failover.returnAccountBtn', { label: notice.fromLabel })
        : null,
    revertTooltip: notice.fromAccountId
      ? translate(locale, 'failover.returnTooltip', {
          from: '',
          fromAccount: notice.fromDisplay,
        }).trim()
      : null,
  };
}
