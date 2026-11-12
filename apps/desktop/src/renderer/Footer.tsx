import { useEffect, useMemo, useRef } from 'react';
import type { ProviderId } from '@inova/core/types';
import type { UsageWindow } from '@inova/core/chat-types';
import type { AccountView } from '../shared/api';
import { groupByProvider, usageLevel } from './footer-state';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME } from './provider-meta';
import { STATUS_TEXT, type UsageState } from './UsageBar';
import './footer.css';

export type { UsageState } from './UsageBar';

export interface FooterProps {
  accounts: AccountView[];
  focusedAccountLabel: string | null;
  usage: Record<string, UsageState>;
  onLoadUsage: (account: AccountView) => void;
  onManageAccounts: () => void;
}

const WINDOW_LABEL: Record<UsageWindow['kind'], string> = { session: 'Sessão', weekly: 'Semana' };

function readyWindows(state: UsageState | undefined): UsageWindow[] {
  if (!state || state.status !== 'ready') return [];
  const { windows } = state.snapshot;
  return (['session', 'weekly'] as const).flatMap((kind) => windows.filter((w) => w.kind === kind));
}

function FooterMeter(props: { window: UsageWindow; provider: ProviderId }) {
  const { window: usageWindow, provider } = props;
  const percent = Math.max(0, Math.min(100, usageWindow.usedPercent));
  const color = usageLevel(percent) === 'critical' ? 'var(--error)' : `var(--${provider})`;
  return (
    <span className="footer-meter">
      <span>{WINDOW_LABEL[usageWindow.kind]}</span>
      <span className="footer-track">
        <span className="footer-fill" style={{ width: `${percent}%`, background: color }} />
      </span>
      <span className="mono footer-percent">{Math.round(percent)}%</span>
    </span>
  );
}

export function Footer(props: FooterProps) {
  const { accounts, focusedAccountLabel, usage, onLoadUsage, onManageAccounts } = props;
  const loadRef = useRef(onLoadUsage);

  const groups = useMemo(() => groupByProvider(accounts), [accounts]);
  const shown = useMemo(
    () =>
      groups.map((group) => ({
        group,
        account:
          group.accounts.find((a) => a.label === focusedAccountLabel) ??
          group.accounts.find((a) => a.status === 'logged-in') ??
          group.accounts[0],
      })),
    [groups, focusedAccountLabel],
  );

  useEffect(() => {
    loadRef.current = onLoadUsage;
  });

  const missingLabels = shown
    .flatMap(({ account }) =>
      account && account.status === 'logged-in' && usage[account.label] === undefined
        ? [account.label]
        : [],
    )
    .join('\n');
  useEffect(() => {
    if (!missingLabels) return;
    const missing = new Set(missingLabels.split('\n'));
    shown.forEach(({ account }) => {
      if (account && missing.has(account.label)) loadRef.current(account);
    });
  }, [shown, missingLabels]);

  return (
    <footer className="footer-bar" aria-label="Provedores conectados">
      {shown.length === 0 ? <span className="footer-empty">Nenhuma conta conectada</span> : null}
      {shown.map(({ group, account }) => {
        if (!account) return null;
        const extra = group.accounts.length - 1;
        const active = account.label === focusedAccountLabel;
        return (
          <div
            key={group.provider}
            className={`footer-group${active ? ' footer-group-active' : ''}`}
          >
            <ProviderBadge provider={group.provider} size={16} />
            <span className="footer-name">
              {PROVIDER_NAME[group.provider]} · {account.label}
            </span>
            {active ? (
              <span className="footer-inuse">
                <span className="footer-inuse-dot" />
                em uso
              </span>
            ) : null}
            {account.status === 'logged-in' ? (
              readyWindows(usage[account.label]).map((w) => (
                <FooterMeter key={w.kind} window={w} provider={group.provider} />
              ))
            ) : (
              <span className="footer-disconnected">{STATUS_TEXT[account.status]}</span>
            )}
            {extra > 0 ? (
              <span className="footer-extra" title={group.accounts.map((a) => a.label).join('\n')}>
                +{extra} {extra === 1 ? 'conta' : 'contas'}
              </span>
            ) : null}
          </div>
        );
      })}
      <button type="button" className="footer-manage" onClick={onManageAccounts}>
        Gerenciar contas
      </button>
    </footer>
  );
}
