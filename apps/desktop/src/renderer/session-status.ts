import type { SupportedLocale } from '@inova/core/types';
import type { ChatState } from './chat-reducer';
import { translate } from './i18n';

export type SessionStatus = 'running' | 'done' | 'error' | 'idle';

export const STATUS_LABEL: Record<SessionStatus, string> = {
  running: 'Executando',
  done: 'Concluída',
  error: 'Erro',
  idle: 'Ociosa',
};

export function sessionStatusLabel(
  status: SessionStatus,
  locale: SupportedLocale = 'pt-BR',
): string {
  switch (status) {
    case 'running':
      return translate(locale, 'status.running');
    case 'done':
      return translate(locale, 'status.done');
    case 'error':
      return translate(locale, 'status.error');
    case 'idle':
      return translate(locale, 'status.idle');
  }
}

export function sessionStatus(state: ChatState | undefined): SessionStatus {
  if (state?.running) return 'running';
  const last = state?.items[state.items.length - 1];
  if (!last) return 'idle';
  if (last.type === 'error') return 'error';
  return last.type === 'user' ? 'idle' : 'done';
}
