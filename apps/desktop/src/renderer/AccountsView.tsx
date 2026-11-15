import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProviderId } from '@inova/core/types';
import type { AccountView, ProjectView } from '../shared/api';
import { AccountCapabilitiesModal } from './AccountCapabilitiesModal';
import {
  AlertIcon,
  CheckIcon,
  ChevronRightIcon,
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
  TrashIcon,
} from './icons';
import {
  PROVIDER_ORDER,
  formatResetDateTime,
  formatResetIn,
  groupByProvider,
  orderedUsageWindows,
  providerHealth,
  usageLevel,
  usageWindowKey,
  usageWindowLabel,
} from './footer-state';
import { useI18n } from './I18nContext';
import type { SupportedLocale } from './i18n';
import { folderName } from './path-name';
import { PlatformSelect } from './PlatformSelect';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_BINARY, PROVIDER_NAME, accountDisplayName } from './provider-meta';
import { relativeTime } from './relative-time';
import { accountStatusText, type UsageState } from './UsageBar';
import type { WarningCall } from './useWarning';
import './views-forms.css';

export interface AccountsViewProps {
  accounts: AccountView[];
  projects: ProjectView[];
  usage: Record<string, UsageState>;
  loggingInLabel?: string | null;
  call: WarningCall;
  onLoadUsage: (account: AccountView) => void;
  onLogin: (account: AccountView) => void;
  onRemove: (account: AccountView) => void;
  onAddAccount: (input: { provider: string; label: string }) => Promise<boolean>;
}

const MAX_PROJECT_CHIPS = 3;

function plural(input: { count: number; one: string; many: string }): string {
  return `${input.count} ${input.count === 1 ? input.one : input.many}`;
}

function fetchedText(
  fetchedAt: string,
  locale: SupportedLocale,
  t: ReturnType<typeof useI18n>['t'],
): string | null {
  const elapsed = relativeTime({ iso: fetchedAt, now: new Date(), locale });
  if (elapsed === '') return null;
  if (elapsed === 'agora' || elapsed === 'ontem' || elapsed === 'now' || elapsed === 'yesterday') {
    return t('accounts.updatedElapsed', { elapsed });
  }
  return t('accounts.updatedAgo', { elapsed });
}

function AccountProjects({ paths }: { paths: readonly string[] }) {
  const { t } = useI18n();
  if (paths.length === 0) {
    return <span className="account-sub">{t('accounts.noProjects')}</span>;
  }
  const shown = paths.slice(0, MAX_PROJECT_CHIPS);
  const rest = paths.length - shown.length;
  return (
    <div className="account-projects" title={paths.join('\n')}>
      {shown.map((path) => (
        <span key={path} className="account-project-chip">
          {folderName(path)}
        </span>
      ))}
      {rest > 0 ? <span className="account-project-more">+{rest}</span> : null}
    </div>
  );
}

function statusTagClass(status: AccountView['status']): string {
  if (status === 'logged-in') return 'account-status-ok';
  if (status === 'unknown') return 'account-status-muted';
  return 'account-status-bad';
}

function NewAccountForm(props: {
  onAddAccount: AccountsViewProps['onAddAccount'];
  onDone: () => void;
}) {
  const { onAddAccount, onDone } = props;
  const { t } = useI18n();
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

  const providerOptions = PROVIDER_ORDER.map((id) => ({
    value: id,
    label: PROVIDER_NAME[id],
    description: `CLI ${PROVIDER_BINARY[id]}`,
    leading: <ProviderBadge provider={id} size={18} />,
  }));

  return (
    <form className="accounts-new" onSubmit={(event) => void submit(event)}>
      <label>
        {t('accounts.providerLabel')}
        <PlatformSelect
          ariaLabel={t('accounts.providerLabel')}
          value={provider}
          options={providerOptions}
          onChange={(next) => setProvider(next as ProviderId)}
        />
      </label>
      <label>
        {t('accounts.labelField')}
        <input
          className="field"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('accounts.labelPlaceholder')}
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={!label.trim() || submitting}>
        {t('common.add')}
      </button>
    </form>
  );
}

function AccountUsage({ state }: { state: UsageState | undefined }) {
  const { t, locale } = useI18n();
  if (!state || state.status === 'loading') {
    return <span className="account-usage-text">{t('accounts.loadingUsage')}</span>;
  }
  if (state.status === 'error') {
    return <span className="account-usage-text account-bad">{state.message}</span>;
  }
  const { snapshot } = state;
  const windows = orderedUsageWindows(snapshot.windows);
  if (snapshot.source === 'unavailable' || windows.length === 0) {
    return <span className="account-usage-text">{t('accounts.usageUnavailable')}</span>;
  }
  const fetched = fetchedText(snapshot.fetchedAt, locale, t);
  const windowLabels = {
    session: t('accounts.windowShort.session'),
    weekly: t('accounts.windowShort.weekly'),
    monthly: t('accounts.windowShort.monthly'),
  };
  const resetNow = t('accounts.resetNow');
  return (
    <div className="account-usage-block">
      <div className="account-usage">
        {windows.map((w) => {
          const percent = Math.max(0, Math.min(100, w.usedPercent));
          const reset = formatResetIn({ resetsAt: w.resetsAt, now: new Date(), locale });
          const exact = formatResetDateTime(w.resetsAt);
          const resetWhen = reset
            ? reset === resetNow
              ? resetNow
              : t('accounts.renewsIn', { reset })
            : null;
          return (
            <div key={usageWindowKey(w)} className="account-usage-window">
              <div className="usage-track">
                <div
                  className={`usage-fill usage-${usageLevel(percent)}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="account-usage-text">
                <span className="mono">{Math.round(percent)}%</span>{' '}
                {usageWindowLabel({ window: w, labels: windowLabels })}
                {resetWhen !== null ? t('accounts.renewsAt', { when: resetWhen }) : ''}
                {exact ? <span className="account-wide-only"> ({exact})</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      {fetched ? <div className="account-usage-fetched account-wide-only">{fetched}</div> : null}
    </div>
  );
}

export function AccountsView(props: AccountsViewProps) {
  const { t, locale } = useI18n();
  const {
    accounts,
    projects,
    usage,
    loggingInLabel = null,
    call,
    onLoadUsage,
    onLogin,
    onRemove,
    onAddAccount,
  } = props;
  const [adding, setAdding] = useState(false);
  const [configuring, setConfiguring] = useState<AccountView | null>(null);
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
            <h1>{t('accounts.title')}</h1>
            <p>{t('accounts.subtitle')}</p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            aria-expanded={adding}
            onClick={() => setAdding((v) => !v)}
          >
            <PlusIcon size={14} />
            {t('accounts.addAccount')}
          </button>
        </div>
        {adding ? (
          <NewAccountForm onAddAccount={onAddAccount} onDone={() => setAdding(false)} />
        ) : null}
        {groups.length === 0 ? (
          <div className="accounts-empty">{t('accounts.empty')}</div>
        ) : (
          <div className="accounts-list">
            {groups.map((group) => {
              const health = providerHealth(group.accounts);
              const groupLabels = new Set(group.accounts.map((a) => a.label));
              const groupProjects = projects.filter((p) => groupLabels.has(p.accountLabel)).length;
              return (
                <details key={group.provider} className="accounts-card" open>
                  <summary className="accounts-card-head">
                    <span className="accounts-card-chevron">
                      <ChevronRightIcon size={16} />
                    </span>
                    <ProviderBadge provider={group.provider} size={28} />
                    <div className="accounts-card-title">
                      <h2>{PROVIDER_NAME[group.provider]}</h2>
                      <div className="accounts-card-meta">
                        <span className="mono">CLI {PROVIDER_BINARY[group.provider]}</span>
                        <span>
                          {group.connected}/
                          {plural({
                            count: group.accounts.length,
                            one: t('accounts.connectedSingular'),
                            many: t('accounts.connectedPlural'),
                          })}
                        </span>
                        <span>
                          {plural({
                            count: groupProjects,
                            one: t('accounts.projectSingular'),
                            many: t('accounts.projectPlural'),
                          })}
                        </span>
                      </div>
                    </div>
                    {health.kind === 'ok' ? (
                      <span className="accounts-health accounts-health-ok">
                        <CheckIcon size={14} />
                        {t('accounts.healthy')}
                      </span>
                    ) : (
                      <span className="accounts-health accounts-health-bad">
                        <AlertIcon size={14} />
                        {health.kind === 'missing-cli'
                          ? t('status.account.binaryMissing')
                          : plural({
                              count: health.count,
                              one: t('accounts.pendingSingular'),
                              many: t('accounts.pendingPlural'),
                            })}
                      </span>
                    )}
                  </summary>
                  <div className="accounts-scroll">
                    <div className="account-row account-row-head section-label">
                      <span>{t('accounts.colAccount')}</span>
                      <span className="account-projects-cell">{t('accounts.colProjects')}</span>
                      <span className="account-col-center">{t('accounts.colStatus')}</span>
                      <span className="account-col-center">{t('accounts.colUsage')}</span>
                      <span className="account-col-center">{t('accounts.colActions')}</span>
                    </div>
                    {group.accounts.map((account) => {
                      const paths = projects
                        .filter((p) => p.accountLabel === account.label)
                        .map((p) => p.path);
                      const display = accountDisplayName(account);
                      return (
                        <div key={account.id} className="account-row">
                          <div className="account-identity">
                            <div className="account-name" title={display}>
                              {display}
                            </div>
                            <div className="account-sub">
                              {display !== account.label ? (
                                <span className="mono">{account.label}</span>
                              ) : null}
                              <span className="account-narrow-only">
                                {plural({
                                  count: paths.length,
                                  one: t('accounts.projectSingular'),
                                  many: t('accounts.projectPlural'),
                                })}
                              </span>
                            </div>
                          </div>
                          <div className="account-projects-cell">
                            <AccountProjects paths={paths} />
                          </div>
                          <span className="account-status-cell">
                            <span
                              className={`account-status-tag ${statusTagClass(account.status)}`}
                            >
                              <span className="dot" aria-hidden="true" />
                              {accountStatusText(account.status, locale)}
                            </span>
                          </span>
                          <div className="account-usage-cell">
                            <AccountUsage state={usage[account.label]} />
                          </div>
                          <div className="account-actions">
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={loggingInLabel === account.label}
                              onClick={() => onLogin(account)}
                            >
                              {loggingInLabel === account.label
                                ? t('accounts.connecting')
                                : account.status === 'logged-in' || account.status === 'expired'
                                  ? t('accounts.renewLogin')
                                  : t('accounts.signIn')}
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={t('accounts.refreshUsage')}
                              data-tooltip={t('accounts.refreshUsageTooltip')}
                              onClick={() => onLoadUsage(account)}
                            >
                              <RefreshIcon size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={t('accounts.configureCapabilities')}
                              data-tooltip={t('accounts.configureCapabilitiesTooltip')}
                              onClick={() => setConfiguring(account)}
                            >
                              <SettingsIcon size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={t('accounts.removeAccountAria', { display })}
                              data-tooltip={t('accounts.removeAccountTooltip')}
                              onClick={() => onRemove(account)}
                            >
                              <TrashIcon size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
      {configuring ? (
        <AccountCapabilitiesModal
          key={configuring.label}
          account={configuring}
          call={call}
          onClose={() => setConfiguring(null)}
        />
      ) : null}
    </div>
  );
}
