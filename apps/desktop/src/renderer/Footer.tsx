import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderId } from '@inova/core/types';
import type { AccountView } from '../shared/api';
import { groupByProvider, highlightedProvider, type ProviderGroup } from './footer-state';
import { PROVIDER_NAME, UsagePopover, type UsageState } from './UsagePopover';
import './footer.css';

export type { UsageState } from './UsagePopover';

export interface FooterProps {
  accounts: AccountView[];
  focusedProvider: ProviderId | null;
  usage: Record<string, UsageState>;
  onLoadUsage: (account: AccountView) => void;
  onLogin: (account: AccountView) => void;
  onRemove: (account: AccountView) => void;
  onAddAccount: (input: { provider: string; label: string }) => void;
}

type OpenPopover = { kind: 'provider'; provider: ProviderId } | { kind: 'new' } | null;

function compactUsage(state: UsageState | undefined): string | null {
  if (!state || state.status !== 'ready') return null;
  const parts = state.snapshot.windows.flatMap((w) => {
    const label = w.kind === 'session' ? 'sessão' : 'semanal';
    return [`${label} ${Math.round(w.usedPercent)}%`];
  });
  return parts.length > 0 ? parts.join(' · ') : null;
}

function firstLoggedIn(group: ProviderGroup | undefined): AccountView | undefined {
  return group?.accounts.find((account) => account.status === 'logged-in');
}

export function Footer(props: FooterProps) {
  const { accounts, focusedProvider, usage, onLoadUsage, onLogin, onRemove, onAddAccount } = props;
  const [open, setOpen] = useState<OpenPopover>(null);
  const rootRef = useRef<HTMLElement>(null);
  const loadRef = useRef(onLoadUsage);

  const groups = useMemo(() => groupByProvider(accounts), [accounts]);
  const highlighted = highlightedProvider({ groups, focusedProvider });
  const highlightedGroup = groups.find((group) => group.provider === highlighted);
  const inlineAccount = firstLoggedIn(highlightedGroup);

  useEffect(() => {
    loadRef.current = onLoadUsage;
  });

  const inlineLabel = inlineAccount?.label;
  const inlineMissing = inlineLabel !== undefined && usage[inlineLabel] === undefined;
  useEffect(() => {
    if (inlineAccount && inlineMissing) loadRef.current(inlineAccount);
  }, [inlineAccount, inlineMissing]);

  const openGroup =
    open?.kind === 'provider' ? groups.find((g) => g.provider === open.provider) : undefined;
  const openAccountsMissingUsage = openGroup?.accounts
    .filter((account) => usage[account.label] === undefined)
    .map((account) => account.label)
    .join('\n');
  useEffect(() => {
    if (!openGroup || !openAccountsMissingUsage) return;
    const missing = new Set(openAccountsMissingUsage.split('\n'));
    openGroup.accounts.filter((a) => missing.has(a.label)).forEach((a) => loadRef.current(a));
  }, [openGroup, openAccountsMissingUsage]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const popoverProps = { usage, onLoadUsage, onLogin, onRemove, onAddAccount };

  return (
    <footer className="footer-bar" ref={rootRef}>
      <div className="footer-chips">
        {groups.length === 0 ? <span className="footer-empty">Nenhuma conta conectada</span> : null}
        {groups.map((group) => {
          const isOpen = open?.kind === 'provider' && open.provider === group.provider;
          const isHighlighted = group.provider === highlighted;
          return (
            <div className="footer-anchor" key={group.provider}>
              <button
                type="button"
                className={`footer-chip${isHighlighted ? ' footer-chip-active' : ''}`}
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen(isOpen ? null : { kind: 'provider', provider: group.provider })
                }
              >
                <span>{PROVIDER_NAME[group.provider]}</span>
                <span
                  className={`footer-dot ${group.connected > 0 ? 'footer-dot-ok' : 'footer-dot-warn'}`}
                />
                <span className="footer-count">{group.accounts.length}</span>
                {isHighlighted && inlineAccount ? (
                  <span className="footer-inline">
                    {inlineAccount.label}
                    {compactUsage(usage[inlineAccount.label])
                      ? ` · ${compactUsage(usage[inlineAccount.label])}`
                      : ''}
                  </span>
                ) : null}
              </button>
              {isOpen ? (
                <UsagePopover
                  mode={{ kind: 'provider', provider: group.provider, accounts: group.accounts }}
                  {...popoverProps}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="footer-anchor footer-anchor-right">
        <button
          type="button"
          className="footer-chip"
          aria-expanded={open?.kind === 'new'}
          onClick={() => setOpen(open?.kind === 'new' ? null : { kind: 'new' })}
        >
          + conta
        </button>
        {open?.kind === 'new' ? <UsagePopover mode={{ kind: 'new' }} {...popoverProps} /> : null}
      </div>
    </footer>
  );
}
