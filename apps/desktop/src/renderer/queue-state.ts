import type { SupportedLocale } from '@inova/core/types';
import { translate } from './i18n';

export function queueCountLabel(count: number, locale: SupportedLocale = 'pt-BR'): string {
  return count === 1
    ? translate(locale, 'queue.singular')
    : translate(locale, 'queue.plural', { count });
}

export function queuedCardLabel(
  waitingForAccount: boolean,
  locale: SupportedLocale = 'pt-BR',
): string {
  return waitingForAccount
    ? translate(locale, 'queue.cardDefault')
    : translate(locale, 'tabs.running') === 'Executando'
      ? 'Na fila'
      : translate(locale, 'chat.queuedBadge');
}

export function isAccountBusyElsewhere(input: {
  sessionId: string;
  accountId: string | undefined;
  runningAccounts: ReadonlyMap<string, string | undefined>;
}): boolean {
  if (input.accountId === undefined) return false;
  for (const [sessionId, accountId] of input.runningAccounts) {
    if (sessionId !== input.sessionId && accountId === input.accountId) return true;
  }
  return false;
}
