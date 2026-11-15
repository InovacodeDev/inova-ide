import type { CapabilityKind, CapabilityListing } from '../shared/api';
import { CAPABILITY_TABS } from './capabilities-state';
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
  return (
    <div className="capabilities-toolbar">
      <div className="capabilities-tabs" role="tablist" aria-label="Categorias">
        {CAPABILITY_TABS.filter(({ kind }) => tabs.includes(kind)).map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={kind === active}
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
