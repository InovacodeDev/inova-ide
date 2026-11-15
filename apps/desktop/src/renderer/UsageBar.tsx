import type { UsageSnapshot } from '@inova/core/chat-types';
import type { SupportedLocale } from '@inova/core/types';
import type { AccountStatus } from '../shared/api';
import type { TranslationKey } from './i18n';
import { translate } from './i18n';

export type UsageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: UsageSnapshot };

export const STATUS_TEXT: Record<AccountStatus, string> = {
  'logged-in': 'conectada',
  'logged-out': 'desconectada',
  expired: 'sessão expirada',
  'binary-missing': 'CLI não instalado',
  unknown: 'desconhecido',
};

const STATUS_KEY: Record<AccountStatus, TranslationKey> = {
  'logged-in': 'status.account.loggedIn',
  'logged-out': 'status.account.loggedOut',
  expired: 'status.account.expired',
  'binary-missing': 'status.account.binaryMissing',
  unknown: 'status.account.unknown',
};

export function accountStatusText(
  status: AccountStatus,
  locale: SupportedLocale = 'pt-BR',
): string {
  return translate(locale, STATUS_KEY[status]);
}
