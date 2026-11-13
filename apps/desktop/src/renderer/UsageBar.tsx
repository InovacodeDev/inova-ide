import type { AuthStatus } from '@inova/core/providers';
import type { UsageSnapshot } from '@inova/core/chat-types';

export type UsageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: UsageSnapshot };

export const STATUS_TEXT: Record<AuthStatus, string> = {
  'logged-in': 'conectada',
  'logged-out': 'desconectada',
  'binary-missing': 'CLI não instalado',
  unknown: 'desconhecido',
};
