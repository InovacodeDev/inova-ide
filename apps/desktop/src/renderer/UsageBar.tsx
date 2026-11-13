import type { AuthStatus } from '@inova/core/providers';
import type { UsageSnapshot, UsageWindow } from '@inova/core/chat-types';
import { formatResetIn, orderedUsageWindows, usageLevel } from './footer-state';

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

const WINDOW_TITLE: Record<UsageWindow['kind'], string> = {
  session: 'Sessão (5h)',
  weekly: 'Semanal',
  monthly: 'Mensal',
};

export function UsageBar({ window: usageWindow }: { window: UsageWindow }) {
  const percent = Math.max(0, Math.min(100, usageWindow.usedPercent));
  const reset = formatResetIn({ resetsAt: usageWindow.resetsAt, now: new Date() });
  return (
    <div className="usage-row">
      <div className="usage-row-head">
        <span>{WINDOW_TITLE[usageWindow.kind]}</span>
        <span>{Math.round(percent)}%</span>
      </div>
      <div className="usage-track">
        <div
          className={`usage-fill usage-${usageLevel(percent)}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {reset ? (
        <small className="usage-reset">renova {reset === 'agora' ? 'agora' : `em ${reset}`}</small>
      ) : null}
    </div>
  );
}

export function UsageSection({ state }: { state: UsageState | undefined }) {
  if (!state) return <p className="usage-note">Consumo indisponível</p>;
  if (state.status === 'loading') return <p className="usage-note">carregando consumo…</p>;
  if (state.status === 'error') {
    return <p className="usage-note usage-error">{state.message}</p>;
  }
  const { snapshot } = state;
  const windows = orderedUsageWindows(snapshot.windows);
  if (snapshot.source === 'unavailable' || windows.length === 0) {
    return <p className="usage-note">Consumo indisponível para este provedor</p>;
  }
  return (
    <div className="usage-bars">
      {windows.map((w) => (
        <UsageBar key={w.kind} window={w} />
      ))}
    </div>
  );
}
