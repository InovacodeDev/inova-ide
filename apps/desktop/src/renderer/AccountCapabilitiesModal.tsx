import { useEffect, useRef, useState } from 'react';
import type { AccountView, CapabilityItem, CapabilityKind } from '../shared/api';
import { displayEnabled, filterItems, sortItems, visibleTabs } from './capabilities-state';
import { CapabilityRow, CostSummary } from './CapabilityRow';
import { CapabilityTabs } from './CapabilityTabs';
import { ConfirmModal } from './ConfirmModal';
import { CloseIcon } from './icons';
import { useI18n } from './I18nContext';
import { PROVIDER_NAME, accountDisplayName } from './provider-meta';
import { capabilityKey, useCapabilities } from './useCapabilities';
import { useDialogFocus } from './useDialogFocus';
import type { WarningCall } from './useWarning';
import './modal.css';
import './capabilities.css';

export function AccountCapabilitiesModal(props: {
  account: AccountView;
  call: WarningCall;
  onClose: () => void;
}) {
  const { account, call, onClose } = props;
  const { t } = useI18n();
  const { listing, loading, pendingKey, toggle } = useCapabilities({
    accountLabel: account.label,
    call,
  });
  const [tab, setTab] = useState<CapabilityKind | null>(null);
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState<{ item: CapabilityItem; enabled: boolean } | null>(
    null,
  );

  const cardRef = useRef<HTMLDivElement>(null);

  useDialogFocus(cardRef);

  useEffect(() => {
    if (confirming) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirming, onClose]);

  const tabs = listing ? visibleTabs(listing) : [];
  const activeKind = tab !== null && tabs.includes(tab) ? tab : (tabs[0] ?? null);
  const category = listing?.categories.find((entry) => entry.kind === activeKind);
  const plugins = listing?.categories.find((entry) => entry.kind === 'plugin')?.items ?? [];
  const items = filterItems({ items: sortItems(category?.items ?? []), query });
  const showCost = activeKind === 'mcp' || activeKind === 'connector';

  const requestToggle = (item: CapabilityItem, enabled: boolean) => {
    if (item.applyMode === 'global-file') setConfirming({ item, enabled });
    else void toggle({ item, enabled });
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="capabilities-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={cardRef} className="modal-card capabilities-card" tabIndex={-1}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 id="capabilities-title" className="modal-title">
              {t('capabilities.title', {
                label: accountDisplayName(account),
                provider: PROVIDER_NAME[account.provider],
              })}
            </h2>
            {loading && listing ? (
              <span className="modal-subtitle">{t('common.updating')}</span>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('capabilities.close')}
            data-tooltip={t('common.close')}
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="capabilities-body">
          {!listing ? (
            <p className="capabilities-empty">
              {loading ? t('common.loading') : t('capabilities.loadFailed')}
            </p>
          ) : activeKind === null ? (
            <p className="capabilities-empty">{t('capabilities.noItems')}</p>
          ) : (
            <>
              <CapabilityTabs
                listing={listing}
                tabs={tabs}
                active={activeKind}
                query={query}
                onSelect={setTab}
                onQuery={setQuery}
              />
              {showCost && listing.cost ? <CostSummary cost={listing.cost} /> : null}
              {activeKind === 'connector' ? (
                <p className="capabilities-warning">{t('capabilities.connectorsWarning')}</p>
              ) : null}
              {category?.error ? <p className="capabilities-error">{category.error}</p> : null}
              <ul className="capabilities-list">
                {items.map((item) => (
                  <CapabilityRow
                    key={capabilityKey(item)}
                    item={item}
                    checked={displayEnabled({ item, plugins })}
                    pending={pendingKey === capabilityKey(item)}
                    locked={pendingKey !== null}
                    onToggle={requestToggle}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="modal-footer capabilities-footer">{t('capabilities.footerNote')}</div>
      </div>
      {confirming ? (
        <ConfirmModal
          title={t('capabilities.confirmGlobalTitle')}
          description={t('capabilities.confirmGlobal')}
          confirmLabel={t('common.confirm')}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const { item, enabled } = confirming;
            setConfirming(null);
            void toggle({ item, enabled });
          }}
        />
      ) : null}
    </div>
  );
}
