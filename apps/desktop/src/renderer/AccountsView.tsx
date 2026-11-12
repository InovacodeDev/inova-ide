import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProviderId } from '@inova/core/types';
import type { AccountView, ProjectView } from '../shared/api';
import { AlertIcon, CheckIcon, PlusIcon, RefreshIcon, TrashIcon } from './icons';
import { PROVIDER_ORDER, formatResetIn, groupByProvider, usageLevel } from './footer-state';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME } from './provider-meta';
import { STATUS_TEXT, type UsageState } from './UsageBar';
import './views-forms.css';

export interface AccountsViewProps {
  accounts: AccountView[];
  projects: ProjectView[];
  usage: Record<string, UsageState>;
  onLoadUsage: (account: AccountView) => void;
  onLogin: (account: AccountView) => void;
  onRemove: (account: AccountView) => void;
  onAddAccount: (input: { provider: string; label: string }) => Promise<boolean>;
}

const WINDOW_LABEL = { session: 'sessão', weekly: 'semana' } as const;

function statusClass(status: AccountView['status']): string {
  if (status === 'logged-in') return 'account-ok';
  if (status === 'unknown') return 'account-muted';
  return 'account-bad';
}

function NewAccountForm(props: {
  onAddAccount: AccountsViewProps['onAddAccount'];
  onDone: () => void;
}) {
  const { onAddAccount, onDone } = props;
  const [provider, setProvider] = useState<ProviderId>('claude');
  const [label, setLabel] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (await onAddAccount({ provider, label: label.trim() })) {
        setLabel('');
        onDone();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="accounts-new" onSubmit={(event) => void submit(event)}>
      <label>
        Provedor
        <select
          className="field"
          value={provider}
          onChange={(e) => setProvider(e.target.value as ProviderId)}
        >
          {PROVIDER_ORDER.map((id) => (
            <option key={id} value={id}>
              {PROVIDER_NAME[id]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Rótulo
        <input
          className="field"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="ex.: trabalho"
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={!label.trim() || submitting}>
        Adicionar
      </button>
    </form>
  );
}

function AccountUsage({ state }: { state: UsageState | undefined }) {
  if (!state || state.status === 'loading') {
    return <span className="account-usage-text">carregando consumo…</span>;
  }
  if (state.status === 'error') {
    return <span className="account-usage-text account-bad">{state.message}</span>;
  }
  const { snapshot } = state;
  const windows = (['session', 'weekly'] as const).flatMap((kind) =>
    snapshot.windows.filter((w) => w.kind === kind),
  );
  if (snapshot.source === 'unavailable' || windows.length === 0) {
    return <span className="account-usage-text">Consumo indisponível</span>;
  }
  return (
    <div className="account-usage">
      {windows.map((w) => {
        const percent = Math.max(0, Math.min(100, w.usedPercent));
        const reset = formatResetIn({ resetsAt: w.resetsAt, now: new Date() });
        return (
          <div key={w.kind}>
            <div className="usage-track">
              <div
                className={`usage-fill usage-${usageLevel(percent)}`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="account-usage-text">
              <span className="mono">{Math.round(percent)}%</span> {WINDOW_LABEL[w.kind]}
              {reset ? ` · renova ${reset}` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AccountsView(props: AccountsViewProps) {
  const { accounts, projects, usage, onLoadUsage, onLogin, onRemove, onAddAccount } = props;
  const [adding, setAdding] = useState(false);
  const loadRef = useRef(onLoadUsage);
  loadRef.current = onLoadUsage;

  const missing = accounts.filter((a) => a.status === 'logged-in' && !usage[a.label]);
  const missingKey = missing.map((a) => a.label).join('\n');
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  useEffect(() => {
    if (!missingKey) return;
    const labels = new Set(missingKey.split('\n'));
    accountsRef.current.filter((a) => labels.has(a.label)).forEach((a) => loadRef.current(a));
  }, [missingKey]);

  const groups = groupByProvider(accounts);

  return (
    <div className="view-scroll">
      <div className="accounts-view">
        <div className="accounts-head">
          <div>
            <h1>Contas e providers</h1>
            <p>
              Cada provider é um CLI oficial. Cada conta mantém o próprio login e o próprio limite
              de uso.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            aria-expanded={adding}
            onClick={() => setAdding((v) => !v)}
          >
            <PlusIcon size={14} />
            Adicionar conta
          </button>
        </div>
        {adding ? (
          <NewAccountForm onAddAccount={onAddAccount} onDone={() => setAdding(false)} />
        ) : null}
        {groups.length === 0 ? (
          <div className="accounts-empty">
            Nenhuma conta ainda. Adicione uma conta para começar.
          </div>
        ) : null}
        {groups.map((group) => {
          const missingCli = group.accounts.some((a) => a.status === 'binary-missing');
          return (
            <section key={group.provider} className="accounts-card">
              <div className="accounts-card-head">
                <ProviderBadge provider={group.provider} size={28} />
                <h2>{PROVIDER_NAME[group.provider]}</h2>
                <span className="accounts-binary">binário {group.provider}</span>
                {missingCli ? (
                  <span className="accounts-health accounts-health-bad">
                    <AlertIcon size={14} />
                    CLI não instalado
                  </span>
                ) : (
                  <span className="accounts-health accounts-health-ok">
                    <CheckIcon size={14} />
                    Saudável
                  </span>
                )}
              </div>
              <div className="accounts-scroll">
                <div className="account-row account-row-head section-label">
                  <span>Conta</span>
                  <span>Status</span>
                  <span>Uso</span>
                  <span />
                </div>
                {group.accounts.map((account) => {
                  const count = projects.filter((p) => p.accountLabel === account.label).length;
                  return (
                    <div key={account.id} className="account-row">
                      <div>
                        <div className="account-name">{account.label}</div>
                        <div className="account-sub">
                          {count} {count === 1 ? 'projeto' : 'projetos'}
                        </div>
                      </div>
                      <span className={statusClass(account.status)}>
                        {STATUS_TEXT[account.status]}
                      </span>
                      <AccountUsage state={usage[account.label]} />
                      <div className="account-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => onLogin(account)}
                        >
                          {account.status === 'logged-in' ? 'Renovar login' : 'Entrar'}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="Atualizar consumo"
                          title="Atualizar consumo"
                          onClick={() => onLoadUsage(account)}
                        >
                          <RefreshIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Remover conta ${account.label}`}
                          title="Remover conta"
                          onClick={() => onRemove(account)}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
