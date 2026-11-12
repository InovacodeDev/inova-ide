import type { ChatState } from './chat-reducer';

export type SessionStatus = 'running' | 'done' | 'error' | 'idle';

export const STATUS_LABEL: Record<SessionStatus, string> = {
  running: 'Executando',
  done: 'Concluída',
  error: 'Erro',
  idle: 'Ociosa',
};

export function sessionStatus(state: ChatState | undefined): SessionStatus {
  if (state?.running) return 'running';
  const last = state?.items[state.items.length - 1];
  if (!last) return 'idle';
  if (last.type === 'error') return 'error';
  return last.type === 'user' ? 'idle' : 'done';
}
