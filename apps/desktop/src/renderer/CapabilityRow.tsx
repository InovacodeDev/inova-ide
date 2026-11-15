import type { CapabilityItem, CapabilityListing } from '../shared/api';
import { applyModeLabel } from './capabilities-state';
import { Switch } from './settings-controls';
import { formatTokens } from './token-format';
import { capabilityKey } from './useCapabilities';
import './capabilities.css';

const TOKENS_TOOLTIP =
  'Tamanho das definições. Com a busca de ferramentas, só os nomes entram em cada mensagem.';

export function CostSummary({ cost }: { cost: NonNullable<CapabilityListing['cost']> }) {
  const rows = [
    { label: 'Carregado em cada mensagem', value: cost.loadedTokens },
    { label: 'Instruções dos servidores', value: cost.instructionTokens },
    { label: 'Adiado (não conta por mensagem)', value: cost.deferredTokens },
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
  onToggle: (item: CapabilityItem, enabled: boolean) => void;
}) {
  const { item, checked, pending, onToggle } = props;
  const unsupported = item.applyMode === 'unsupported';
  const inputId = `capability-${capabilityKey(item)}`;
  const detail = [item.group, item.description].filter(Boolean).join(' · ');
  const tokenTooltip =
    item.kind === 'mcp' || item.kind === 'connector' ? TOKENS_TOOLTIP : undefined;
  return (
    <li className="capabilities-row">
      <label className="capabilities-name" htmlFor={inputId}>
        <span className="capabilities-title">{item.name}</span>
        {detail ? <span className="capabilities-detail">{detail}</span> : null}
      </label>
      <span className="capabilities-mode">{applyModeLabel(item.applyMode)}</span>
      {item.tokens !== null ? (
        <span className="capabilities-tokens mono" data-tooltip={tokenTooltip}>
          {formatTokens(item.tokens)}
        </span>
      ) : null}
      <span data-tooltip={unsupported ? (item.unsupportedReason ?? undefined) : undefined}>
        <Switch
          id={inputId}
          checked={checked}
          disabled={unsupported || pending}
          onChange={(enabled) => onToggle(item, enabled)}
        />
      </span>
    </li>
  );
}
