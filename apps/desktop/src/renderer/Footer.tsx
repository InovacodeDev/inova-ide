import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderId } from '@inova/core/types';
import type { UsageWindow } from '@inova/core/chat-types';
import type { AccountView } from '../shared/api';
import {
  formatResetDateTime,
  formatResetIn,
  groupByProvider,
  orderedUsageWindows,
  usageLevel,
} from './footer-state';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME, accountDisplayName } from './provider-meta';
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

const WINDOW_LABEL: Record<UsageWindow['kind'], string> = {
  session: 'Sessão',
  weekly: 'Semana',
  monthly: 'Mês',
};

const POPOVER_WINDOW_LABEL: Record<UsageWindow['kind'], string> = {
  session: 'Sessão (5h)',
  weekly: 'Semanal',
  monthly: 'Mensal',
};

const POPOVER_CLOSE_DELAY_MS = 120;
const COUNTDOWN_TICK_MS = 15_000;

function readyWindows(state: UsageState | undefined): UsageWindow[] {
  if (!state || state.status !== 'ready') return [];
  return orderedUsageWindows(state.snapshot.windows);
}

function formatResetSummary(resetsAt: string | null, nowMs: number): string {
  const countdown = formatResetIn({ resetsAt, now: new Date(nowMs) });
  if (!countdown) return 'Sem data de reset';
  const prefix = countdown === 'agora' ? 'Reseta agora' : `Reseta em ${countdown}`;
  const exact = formatResetDateTime(resetsAt);
  return exact ? `${prefix} · ${exact}` : prefix;
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

function PopoverAccountCard(props: {
  account: AccountView;
  active: boolean;
  highlighted: boolean;
  usageState: UsageState | undefined;
  nowMs: number;
}) {
  const { account, active, highlighted, usageState, nowMs } = props;
  const windows = readyWindows(usageState);
  const classNames = ['footer-popover-card'];
  if (active) classNames.push('footer-popover-card-active');
  else if (highlighted) classNames.push('footer-popover-card-highlight');

  return (
    <article className={classNames.join(' ')}>
      <div className="footer-popover-card-head">
        <div className="footer-popover-identity">
          <ProviderBadge provider={account.provider} size={18} />
          <div className="footer-popover-titles">
            <span className="footer-popover-account">{accountDisplayName(account)}</span>
            <span className="footer-popover-provider">{PROVIDER_NAME[account.provider]}</span>
          </div>
        </div>
        {active ? (
          <span className="footer-popover-status footer-popover-status-active">
            <span className="footer-inuse-dot" />
            em uso
          </span>
        ) : account.status === 'logged-in' ? (
          <span className="footer-popover-status footer-popover-status-connected">conectada</span>
        ) : (
          <span className="footer-popover-status">{STATUS_TEXT[account.status]}</span>
        )}
      </div>
      {account.status !== 'logged-in' ? (
        <p className="footer-popover-note">{STATUS_TEXT[account.status]}</p>
      ) : !usageState || usageState.status === 'loading' ? (
        <p className="footer-popover-note">Carregando uso e resets…</p>
      ) : usageState.status === 'error' ? (
        <p className="footer-popover-note footer-popover-note-error">{usageState.message}</p>
      ) : windows.length === 0 ? (
        <p className="footer-popover-note">Nenhum limite disponível para esta conta.</p>
      ) : (
        <div className="footer-popover-windows">
          {windows.map((w) => {
            const percent = Math.max(0, Math.min(100, w.usedPercent));
            const color =
              usageLevel(percent) === 'critical' ? 'var(--error)' : `var(--${account.provider})`;
            return (
              <div key={w.kind} className="footer-popover-win">
                <div className="footer-popover-win-head">
                  <span className="footer-popover-win-label">{POPOVER_WINDOW_LABEL[w.kind]}</span>
                  <span className="mono footer-popover-win-percent">{Math.round(percent)}%</span>
                </div>
                <div className="footer-popover-track">
                  <div
                    className="footer-popover-fill"
                    style={{ width: `${percent}%`, background: color }}
                  />
                </div>
                <span className="mono footer-popover-reset">
                  {formatResetSummary(w.resetsAt, nowMs)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

export function Footer(props: FooterProps) {
  const { accounts, focusedAccountLabel, usage, onLoadUsage, onManageAccounts } = props;
  const loadRef = useRef(onLoadUsage);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [hoveredProvider, setHoveredProvider] = useState<ProviderId | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const groups = useMemo(() => groupByProvider(accounts), [accounts]);
  const allAccounts = useMemo(() => groups.flatMap((group) => group.accounts), [groups]);
  const connectedCount = useMemo(
    () => accounts.filter((account) => account.status === 'logged-in').length,
    [accounts],
  );
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

  const clearCloseTimer = useCallback(() => {
    if (!closeTimerRef.current) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const openPopover = useCallback(
    (provider?: ProviderId) => {
      clearCloseTimer();
      setNowMs(Date.now());
      setPopoverOpen(true);
      if (provider !== undefined) setHoveredProvider(provider);
    },
    [clearCloseTimer],
  );

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setPopoverOpen(false);
      setHoveredProvider(null);
      closeTimerRef.current = null;
    }, POPOVER_CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  useEffect(() => {
    loadRef.current = onLoadUsage;
  });

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  const missingShownLabels = shown
    .flatMap(({ account }) =>
      account && account.status === 'logged-in' && usage[account.label] === undefined
        ? [account.label]
        : [],
    )
    .join('\n');
  useEffect(() => {
    if (!missingShownLabels) return;
    const missing = new Set(missingShownLabels.split('\n'));
    shown.forEach(({ account }) => {
      if (account && missing.has(account.label)) loadRef.current(account);
    });
  }, [shown, missingShownLabels]);

  const missingPopoverLabels = popoverOpen
    ? accounts
        .flatMap((account) =>
          account.status === 'logged-in' && usage[account.label] === undefined
            ? [account.label]
            : [],
        )
        .join('\n')
    : '';
  useEffect(() => {
    if (!popoverOpen || !missingPopoverLabels) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const missing = new Set(missingPopoverLabels.split('\n'));
      accounts.forEach((account) => {
        if (missing.has(account.label)) loadRef.current(account);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [popoverOpen, accounts, missingPopoverLabels]);

  useEffect(() => {
    if (!popoverOpen) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, COUNTDOWN_TICK_MS);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPopoverOpen(false);
        setHoveredProvider(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [popoverOpen]);

  return (
    <div className="footer-shell" onMouseEnter={() => openPopover()} onMouseLeave={scheduleClose}>
      {popoverOpen && allAccounts.length > 0 ? (
        <section
          className="footer-popover"
          aria-label="Detalhes de uso e reset das contas"
          onMouseEnter={() => openPopover()}
        >
          <header className="footer-popover-head">
            <span className="footer-popover-title">Detalhes das contas</span>
            <span className="footer-popover-summary">
              {connectedCount} {connectedCount === 1 ? 'conectada' : 'conectadas'} ·{' '}
              {allAccounts.length} {allAccounts.length === 1 ? 'conta' : 'contas'}
            </span>
          </header>
          <div className="footer-popover-list">
            {allAccounts.map((account) => (
              <PopoverAccountCard
                key={account.label}
                account={account}
                active={account.label === focusedAccountLabel}
                highlighted={hoveredProvider === account.provider}
                usageState={usage[account.label]}
                nowMs={nowMs}
              />
            ))}
          </div>
        </section>
      ) : null}
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
              onMouseEnter={() => openPopover(group.provider)}
            >
              <ProviderBadge provider={group.provider} size={16} />
              <span className="footer-name">
                {PROVIDER_NAME[group.provider]} · {accountDisplayName(account)}
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
                <span
                  className="footer-extra"
                  title={group.accounts.map((a) => accountDisplayName(a)).join('\n')}
                >
                  +{extra} {extra === 1 ? 'conta' : 'contas'}
                </span>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className="footer-manage"
          onClick={() => {
            clearCloseTimer();
            setPopoverOpen(false);
            setHoveredProvider(null);
            onManageAccounts();
          }}
        >
          Gerenciar contas
        </button>
      </footer>
    </div>
  );
}
