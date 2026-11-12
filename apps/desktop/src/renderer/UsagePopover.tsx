import { useState, type FormEvent } from 'react';
import type { AuthStatus } from '@inova/core/providers';
import type { UsageSnapshot, UsageWindow } from '@inova/core/chat-types';
import type { ProviderId } from '@inova/core/types';
import type { AccountView } from '../shared/api';
import { PROVIDER_ORDER, formatResetIn, usageLevel } from './footer-state';

export type UsageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: UsageSnapshot };

export const PROVIDER_NAME: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

const STATUS_TEXT: Record<AuthStatus, string> = {
  'logged-in': 'conectada',
  'logged-out': 'desconectada',
  'binary-missing': 'CLI não instalado',
  unknown: 'desconhecido',
};

const WINDOW_TITLE: Record<UsageWindow['kind'], string> = {
  session: 'Sessão (5h)',
  weekly: 'Semanal',
};

export interface UsagePopoverProps {
  mode: { kind: 'provider'; provider: ProviderId; accounts: AccountView[] } | { kind: 'new' };
  usage: Record<string, UsageState>;
  onLoadUsage: (account: AccountView) => void;
  onLogin: (account: AccountView) => void;
  onRemove: (account: AccountView) => void;
  onAddAccount: (input: { provider: string; label: string }) => void;
}

function UsageBar({ window: usageWindow }: { window: UsageWindow }) {
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
      {reset ? <small className="usage-reset">renova {reset}</small> : null}
    </div>
  );
}

function UsageSection({ state }: { state: UsageState | undefined }) {
  if (!state || state.status === 'loading') {
    return <p className="usage-note">carregando consumo…</p>;
  }
  if (state.status === 'error') {
    return <p className="usage-note usage-error">{state.message}</p>;
  }
  const { snapshot } = state;
  const windows = (['session', 'weekly'] as const).flatMap((kind) =>
    snapshot.windows.filter((w) => w.kind === kind),
  );
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

function AccountBlock(props: {
  account: AccountView;
  state: UsageState | undefined;
  onLoadUsage: UsagePopoverProps['onLoadUsage'];
  onLogin: UsagePopoverProps['onLogin'];
  onRemove: UsagePopoverProps['onRemove'];
}) {
  const { account, state, onLoadUsage, onLogin, onRemove } = props;
  return (
    <div className="usage-account">
      <div className="usage-account-head">
        <div className="usage-account-name">
          <strong>{account.label}</strong>
          <small>{STATUS_TEXT[account.status]}</small>
        </div>
        <button
          type="button"
          className="usage-icon"
          aria-label="Atualizar consumo"
          title="Atualizar consumo"
          onClick={() => onLoadUsage(account)}
        >
          ↻
        </button>
      </div>
      <UsageSection state={state} />
      <div className="usage-actions">
        <button type="button" onClick={() => onLogin(account)}>
          Entrar
        </button>
        <button type="button" onClick={() => onRemove(account)}>
          Remover
        </button>
      </div>
    </div>
  );
}

function NewAccountForm(props: {
  presetProvider: ProviderId | null;
  onAddAccount: UsagePopoverProps['onAddAccount'];
}) {
  const { presetProvider, onAddAccount } = props;
  const [provider, setProvider] = useState<string>(presetProvider ?? 'claude');
  const [label, setLabel] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAddAccount({ provider, label: label.trim() });
    setLabel('');
  };

  return (
    <form className="usage-form" onSubmit={submit}>
      <select aria-label="Provedor" value={provider} onChange={(e) => setProvider(e.target.value)}>
        {PROVIDER_ORDER.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <input
        aria-label="Rótulo"
        placeholder="Rótulo"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button type="submit" disabled={!label.trim()}>
        Nova conta
      </button>
    </form>
  );
}

export function UsagePopover(props: UsagePopoverProps) {
  const { mode, usage, onLoadUsage, onLogin, onRemove, onAddAccount } = props;
  return (
    <div className="usage-popover" role="dialog">
      {mode.kind === 'provider' ? (
        <>
          <h3>{PROVIDER_NAME[mode.provider]}</h3>
          {mode.accounts.map((account) => (
            <AccountBlock
              key={account.id}
              account={account}
              state={usage[account.label]}
              onLoadUsage={onLoadUsage}
              onLogin={onLogin}
              onRemove={onRemove}
            />
          ))}
        </>
      ) : (
        <h3>Nova conta</h3>
      )}
      <NewAccountForm
        presetProvider={mode.kind === 'provider' ? mode.provider : null}
        onAddAccount={onAddAccount}
      />
    </div>
  );
}
