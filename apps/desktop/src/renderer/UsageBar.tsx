import type { UsageSnapshot } from '@inova/core/chat-types';
import type { AccountStatus } from '../shared/api';

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
