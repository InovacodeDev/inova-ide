import { useEffect, useState } from 'react';
import type { AccountView, CapabilityItem, CapabilityKind } from '../shared/api';
import { displayEnabled, filterItems, sortItems, visibleTabs } from './capabilities-state';
import { CapabilityRow, CostSummary } from './CapabilityRow';
import { CapabilityTabs } from './CapabilityTabs';
import { ConfirmModal } from './ConfirmModal';
import { CloseIcon } from './icons';
import { PROVIDER_NAME, accountDisplayName } from './provider-meta';
import { capabilityKey, useCapabilities } from './useCapabilities';
import type { WarningCall } from './useWarning';
import './modal.css';
import './capabilities.css';

const CONNECTORS_WARNING =
  'As instruções de um conector só saem do contexto quando todos os conectores estão desligados.';
const GLOBAL_CONFIRM = 'Esta mudança afeta todas as contas OpenCode e o OpenCode fora do Inova.';

export function AccountCapabilitiesModal(props: {
  account: AccountView;
  call: WarningCall;
  onClose: () => void;
}) {
  const { account, call, onClose } = props;
  const { listing, loading, pendingKey, toggle } = useCapabilities({
    accountLabel: account.label,
    call,
  });
  const [tab, setTab] = useState<CapabilityKind | null>(null);
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState<{ item: CapabilityItem; enabled: boolean } | null>(
    null,
  );

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
      <div className="modal-card capabilities-card">
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 id="capabilities-title" className="modal-title">
              Configurar conta · {accountDisplayName(account)} ({PROVIDER_NAME[account.provider]})
            </h2>
            {loading && listing ? <span className="modal-subtitle">Atualizando…</span> : null}
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar"
            data-tooltip="Fechar"
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="capabilities-body">
          {!listing ? (
            <p className="capabilities-empty">
              {loading ? 'Carregando…' : 'Não foi possível carregar os itens.'}
            </p>
          ) : activeKind === null ? (
            <p className="capabilities-empty">Este provider não expõe itens configuráveis.</p>
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
                <p className="capabilities-warning">{CONNECTORS_WARNING}</p>
              ) : null}
              {category?.error ? <p className="capabilities-error">{category.error}</p> : null}
              <ul className="capabilities-list">
                {items.map((item) => (
                  <CapabilityRow
                    key={capabilityKey(item)}
                    item={item}
                    checked={displayEnabled({ item, plugins })}
                    pending={pendingKey === capabilityKey(item)}
                    onToggle={requestToggle}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="modal-footer capabilities-footer">
          As mudanças valem a partir da próxima mensagem.
        </div>
      </div>
      {confirming ? (
        <ConfirmModal
          title="Mudança global"
          description={GLOBAL_CONFIRM}
          confirmLabel="Confirmar"
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
