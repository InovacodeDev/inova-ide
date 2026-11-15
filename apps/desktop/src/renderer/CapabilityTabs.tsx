import type { CapabilityKind, CapabilityListing } from '../shared/api';
import { CAPABILITY_TABS } from './capabilities-state';
import { handleHorizontalTabListKeyDown } from './tablist-nav';
import './capabilities.css';

export function CapabilityTabs(props: {
  listing: CapabilityListing;
  tabs: readonly CapabilityKind[];
  active: CapabilityKind;
  query: string;
  onSelect: (kind: CapabilityKind) => void;
  onQuery: (query: string) => void;
}) {
  const { listing, tabs, active, query, onSelect, onQuery } = props;
  const visible = CAPABILITY_TABS.filter(({ kind }) => tabs.includes(kind));
  return (
    <div className="capabilities-toolbar">
      <div
        className="capabilities-tabs"
        role="tablist"
        aria-label="Categorias"
        onKeyDown={(event) =>
          handleHorizontalTabListKeyDown({
            event,
            ids: visible.map(({ kind }) => kind),
            activeId: active,
            onSelect,
          })
        }
      >
        {visible.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={kind === active}
            tabIndex={kind === active ? 0 : -1}
            className="capabilities-tab"
            onClick={() => onSelect(kind)}
          >
            <span>{label}</span>
            <span className="capabilities-tab-count mono">
              {listing.categories.find((entry) => entry.kind === kind)?.items.length}
            </span>
          </button>
        ))}
      </div>
      <input
        className="field capabilities-filter"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="filtrar"
        aria-label="Filtrar itens"
      />
    </div>
  );
}
