import type { CapabilityItem, CapabilityListing } from '../shared/api';
import { applyModeLabel } from './capabilities-state';
import { useI18n } from './I18nContext';
import { Switch } from './settings-controls';
import { formatTokens } from './token-format';
import { capabilityKey } from './useCapabilities';
import './capabilities.css';

export function CostSummary({ cost }: { cost: NonNullable<CapabilityListing['cost']> }) {
  const { t } = useI18n();
  const rows = [
    { label: t('capabilities.costLoaded'), value: cost.loadedTokens },
    { label: t('capabilities.costInstructions'), value: cost.instructionTokens },
    { label: t('capabilities.costDeferred'), value: cost.deferredTokens },
  ];
  return (
    <div className="capabilities-cost">
      {rows.map((row) => (
        <span key={row.label}>
          {row.label}:{' '}
          <span className="mono">{row.value === null ? '—' : formatTokens(row.value)}</span>
        </span>
      ))}
    </div>
  );
}

export function CapabilityRow(props: {
  item: CapabilityItem;
  checked: boolean;
  pending: boolean;
  locked: boolean;
  onToggle: (item: CapabilityItem, enabled: boolean) => void;
}) {
  const { item, checked, pending, locked, onToggle } = props;
  const { locale, t } = useI18n();
  const unsupported = item.applyMode === 'unsupported';
  const inputId = `capability-${capabilityKey(item)}`;
  const detail = [item.group, item.description].filter(Boolean).join(' · ');
  const tokenTooltip =
    item.kind === 'mcp' || item.kind === 'connector' ? t('capabilities.tokensTooltip') : undefined;
  return (
    <li className="capabilities-row">
      <label className="capabilities-name" htmlFor={inputId}>
        <span className="capabilities-title">{item.name}</span>
        {detail ? <span className="capabilities-detail">{detail}</span> : null}
        {unsupported && item.unsupportedReason ? (
          <span className="sr-only">{item.unsupportedReason}</span>
        ) : null}
      </label>
      <span className="capabilities-mode">{applyModeLabel(item.applyMode, locale)}</span>
      {item.tokens !== null ? (
        <span className="capabilities-tokens mono" data-tooltip={tokenTooltip}>
          {formatTokens(item.tokens)}
        </span>
      ) : null}
      <span data-tooltip={unsupported ? (item.unsupportedReason ?? undefined) : undefined}>
        <Switch
          id={inputId}
          checked={checked}
          disabled={unsupported || pending || locked}
          onChange={(enabled) => onToggle(item, enabled)}
        />
      </span>
    </li>
  );
}
