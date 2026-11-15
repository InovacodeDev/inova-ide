import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderId } from '@inova/core/types';
import type { UsageWindow } from '@inova/core/chat-types';
import type { AccountView } from '../shared/api';
import {
  formatResetDateTime,
  formatResetIn,
  groupByProvider,
  orderedUsageWindows,
  primaryUsageWindows,
  usageLevel,
  usageWindowKey,
  usageWindowLabel,
} from './footer-state';
import { useI18n } from './I18nContext';
import { BellIcon } from './icons';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME, accountDisplayName } from './provider-meta';
import { formatMessageTime } from './relative-time';
import { STATUS_TEXT, type UsageState } from './UsageBar';
import type { WarningEntry } from './useWarning';
import './footer.css';
import './update.css';

export type { UsageState } from './UsageBar';

export interface FooterProps {
  accounts: AccountView[];
  focusedAccountLabel: string | null;
  usage: Record<string, UsageState>;
  onLoadUsage: (account: AccountView) => void;
  onManageAccounts: () => void;
  warningHistory?: readonly WarningEntry[];
  onClearWarningHistory?: () => void;
  version?: string | null;
  updateAvailable?: boolean;
  onOpenChangelog?: () => void;
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

const POPOVER_WIDTH_PX = 360;
const POPOVER_EDGE_GAP_PX = 12;
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
  usageState: UsageState | undefined;
  nowMs: number;
}) {
  const { account, active, usageState, nowMs } = props;
  const windows = readyWindows(usageState);

  return (
    <article
      className={active ? 'footer-popover-card footer-popover-card-active' : 'footer-popover-card'}
    >
      <div className="footer-popover-card-head">
        <span className="footer-popover-account">{accountDisplayName(account)}</span>
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
              <div key={usageWindowKey(w)} className="footer-popover-win">
                <div className="footer-popover-win-head">
                  <span className="footer-popover-win-label">
                    {usageWindowLabel({ window: w, labels: POPOVER_WINDOW_LABEL })}
                  </span>
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
  const { warningHistory = [], onClearWarningHistory } = props;
  const { version = null, updateAvailable = false, onOpenChangelog } = props;
  const { t } = useI18n();
  const loadRef = useRef(onLoadUsage);
  const [popover, setPopover] = useState<
    | { kind: 'provider'; provider: ProviderId; alignRight: boolean }
    | { kind: 'alerts'; alignRight: boolean }
    | null
  >(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

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
  const popoverProvider = popover?.kind === 'provider' ? popover.provider : null;
  const alertsOpen = popover?.kind === 'alerts';

  const alignPopoverRight = (anchor: HTMLElement): boolean => {
    const { left } = anchor.getBoundingClientRect();
    return left + POPOVER_WIDTH_PX + POPOVER_EDGE_GAP_PX > window.innerWidth;
  };

  const openPopover = (provider: ProviderId, anchor: HTMLElement) => {
    setNowMs(Date.now());
    setPopover({
      kind: 'provider',
      provider,
      alignRight: alignPopoverRight(anchor),
    });
  };
  const toggleAlertsPopover = (anchor: HTMLElement) => {
    setNowMs(Date.now());
    setPopover((current) =>
      current?.kind === 'alerts' ? null : { kind: 'alerts', alignRight: alignPopoverRight(anchor) },
    );
  };
  const closePopover = () => setPopover(null);

  useEffect(() => {
    loadRef.current = onLoadUsage;
  });

  const missingLabels = accounts
    .flatMap((account) => {
      const isShown = shown.some((entry) => entry.account?.label === account.label);
      const inPopover = account.provider === popoverProvider;
      return (isShown || inPopover) &&
        account.status === 'logged-in' &&
        usage[account.label] === undefined
        ? [account.label]
        : [];
    })
    .join('\n');
  useEffect(() => {
    if (!missingLabels) return;
    const missing = new Set(missingLabels.split('\n'));
    accounts.forEach((account) => {
      if (missing.has(account.label)) loadRef.current(account);
    });
  }, [accounts, missingLabels]);

  useEffect(() => {
    if (popoverProvider === null) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, COUNTDOWN_TICK_MS);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopover(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [popoverProvider]);

  return (
    <footer className="footer-bar" aria-label={t('footer.ariaLabel')}>
      {shown.length === 0 ? (
        <span className="footer-empty">{t('footer.noConnectedAccounts')}</span>
      ) : null}
      {shown.map(({ group, account }) => {
        if (!account) return null;
        const extra = group.accounts.length - 1;
        const active = account.label === focusedAccountLabel;
        const open = popover?.kind === 'provider' && popover.provider === group.provider;
        return (
          <div
            key={group.provider}
            className={`footer-group${active ? ' footer-group-active' : ''}`}
            onMouseEnter={(event) => openPopover(group.provider, event.currentTarget)}
            onMouseLeave={closePopover}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                closePopover();
              }
            }}
          >
            <button
              type="button"
              className="footer-group-trigger"
              aria-expanded={open}
              onClick={(event) => {
                if (!open) openPopover(group.provider, event.currentTarget);
              }}
              onFocus={(event) => openPopover(group.provider, event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && open) {
                  event.preventDefault();
                  closePopover();
                }
              }}
            >
              <ProviderBadge provider={group.provider} size={16} />
              <span className="footer-name">
                {PROVIDER_NAME[group.provider]} · {accountDisplayName(account)}
              </span>
              {active ? (
                <span className="footer-inuse">
                  <span className="footer-inuse-dot" />
                  {t('footer.inUse')}
                </span>
              ) : null}
              {account.status === 'logged-in' ? (
                primaryUsageWindows(readyWindows(usage[account.label])).map((w) => (
                  <FooterMeter key={usageWindowKey(w)} window={w} provider={group.provider} />
                ))
              ) : (
                <span className="footer-disconnected">{STATUS_TEXT[account.status]}</span>
              )}
              {extra > 0 ? (
                <span className="footer-extra">
                  +{extra} {extra === 1 ? t('footer.accountSingular') : t('footer.accountPlural')}
                </span>
              ) : null}
            </button>
            {open ? (
              <section
                className={
                  popover?.alignRight ? 'footer-popover footer-popover-right' : 'footer-popover'
                }
                aria-label={`Uso e reset das contas ${PROVIDER_NAME[group.provider]}`}
              >
                <header className="footer-popover-head">
                  <span className="footer-popover-title">
                    <ProviderBadge provider={group.provider} size={18} />
                    {PROVIDER_NAME[group.provider]}
                  </span>
                  <span className="footer-popover-summary">
                    {group.connected} {group.connected === 1 ? 'conectada' : 'conectadas'} ·{' '}
                    {group.accounts.length} {group.accounts.length === 1 ? 'conta' : 'contas'}
                  </span>
                </header>
                <div className="footer-popover-list">
                  {group.accounts.map((item) => (
                    <PopoverAccountCard
                      key={item.label}
                      account={item}
                      active={item.label === focusedAccountLabel}
                      usageState={usage[item.label]}
                      nowMs={nowMs}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        className="footer-manage"
        data-tooltip={t('footer.manageAccountsTooltip')}
        onClick={onManageAccounts}
      >
        {t('footer.manageAccounts')}
      </button>
      {warningHistory.length > 0 ? (
        <div
          className="footer-alerts-wrap"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              closePopover();
            }
          }}
        >
          <button
            type="button"
            className="footer-alerts-btn"
            aria-label={t('footer.alertsLabel', { count: warningHistory.length })}
            aria-expanded={alertsOpen}
            data-tooltip={t('footer.alertsTooltip')}
            onClick={(event) => toggleAlertsPopover(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && alertsOpen) {
                event.preventDefault();
                closePopover();
              }
            }}
          >
            <BellIcon size={13} />
            <span className="footer-alerts-badge mono">{warningHistory.length}</span>
          </button>
          {alertsOpen ? (
            <section
              className={
                popover?.alignRight
                  ? 'footer-popover footer-popover-right footer-alerts-popover'
                  : 'footer-popover footer-alerts-popover'
              }
              aria-label={t('footer.alertsTitle')}
            >
              <header className="footer-popover-head">
                <span className="footer-popover-title">{t('footer.alertsTitle')}</span>
                {onClearWarningHistory ? (
                  <button
                    type="button"
                    className="footer-alerts-clear"
                    onClick={() => {
                      onClearWarningHistory();
                      closePopover();
                    }}
                  >
                    {t('footer.alertsClear')}
                  </button>
                ) : null}
              </header>
              {warningHistory.length === 0 ? (
                <p className="footer-popover-note">{t('footer.alertsEmpty')}</p>
              ) : (
                <ul className="footer-alerts-list">
                  {warningHistory.map((entry) => (
                    <li key={entry.id} className="footer-alert-row">
                      <span className="footer-alert-time mono">{formatMessageTime(entry.at)}</span>
                      <span className="footer-alert-msg">{entry.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
      {version !== null ? (
        <button
          type="button"
          className="footer-version mono"
          data-tooltip={updateAvailable ? 'Atualização disponível: ver novidades' : 'Ver novidades'}
          aria-label={
            updateAvailable ? `Versão ${version}, atualização disponível` : `Versão ${version}`
          }
          onClick={onOpenChangelog}
        >
          v{version}
          {updateAvailable ? <span className="footer-version-dot" aria-hidden="true" /> : null}
        </button>
      ) : null}
    </footer>
  );
}
