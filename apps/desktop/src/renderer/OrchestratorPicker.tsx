import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  effortsForModel,
  PROVIDER_MODELS,
  splitModelEffortVariant,
  type ProviderModels,
} from '@inova/core/models';
import {
  clampOrchestratorRounds,
  DEFAULT_ORCHESTRATOR_MAX_ROUNDS,
  MAX_ORCHESTRATOR_MAX_ROUNDS,
  MIN_ORCHESTRATOR_MAX_ROUNDS,
} from '@inova/core/orchestrator';
import type { EffortLevel, SessionOrchestratorConfig } from '@inova/core/types';
import type { AccountView } from '../shared/api';
import { CheckIcon, ChevronDownIcon, CompareIcon } from './icons';
import { useI18n } from './I18nContext';
import {
  effortLabel,
  formatPickerLabel,
  normalizeCustomModelInput,
  resolveModelOptions,
} from './model-picker-state';
import { PROVIDER_NAME } from './provider-meta';

export interface OrchestratorPickerProps {
  orchestrator: SessionOrchestratorConfig | null;
  accounts: readonly AccountView[];
  activeAccountId: string | null;
  modelsByAccount: Readonly<Record<string, ProviderModels>>;
  disabled?: boolean;
  openRequest?: number;
  onChange: (next: SessionOrchestratorConfig | null) => void;
}

const ROUND_CHOICES = Array.from(
  { length: MAX_ORCHESTRATOR_MAX_ROUNDS - MIN_ORCHESTRATOR_MAX_ROUNDS + 1 },
  (_, index) => MIN_ORCHESTRATOR_MAX_ROUNDS + index,
);

export function OrchestratorPicker({
  orchestrator,
  accounts,
  activeAccountId,
  modelsByAccount,
  disabled = false,
  openRequest = 0,
  onChange,
}: OrchestratorPickerProps) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draftAccountId, setDraftAccountId] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const isOpen = open && !disabled;

  const handledOpenRequestRef = useRef(openRequest);
  useEffect(() => {
    if (openRequest === handledOpenRequestRef.current) return;
    handledOpenRequestRef.current = openRequest;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [openRequest]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const node = containerRef.current;
      if (node !== null && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const selectedAccount =
    accounts.find((account) => account.id === (draftAccountId ?? orchestrator?.accountId)) ??
    accounts.find((account) => account.id === activeAccountId) ??
    accounts[0] ??
    null;

  if (!selectedAccount) return null;

  const catalog =
    modelsByAccount[selectedAccount.label] ?? PROVIDER_MODELS[selectedAccount.provider];
  const sameAccountAsSaved = orchestrator?.accountId === selectedAccount.id;
  const activeModelValue = sameAccountAsSaved ? (orchestrator?.model ?? null) : null;
  const activeEffortValue = sameAccountAsSaved ? (orchestrator?.effort ?? null) : null;
  const activeRounds = clampOrchestratorRounds(
    orchestrator?.maxRounds ?? DEFAULT_ORCHESTRATOR_MAX_ROUNDS,
  );
  const split = splitModelEffortVariant(catalog, activeModelValue);
  const activeModel = split.model;
  const availableEfforts = effortsForModel(catalog, activeModel);
  const activeEffort = activeEffortValue ?? split.effort;
  const modelOptions = resolveModelOptions({ model: activeModelValue, catalog, locale });
  const normalizedCustom = normalizeCustomModelInput(customDraft);

  const savedAccount =
    accounts.find((account) => account.id === orchestrator?.accountId) ?? selectedAccount;
  const savedCatalog =
    modelsByAccount[savedAccount.label] ?? PROVIDER_MODELS[savedAccount.provider];
  const isEnabled = Boolean(orchestrator?.enabled);
  const triggerModelText = isEnabled
    ? formatPickerLabel({
        model: orchestrator?.model ?? null,
        effort: orchestrator?.effort ?? null,
        catalog: savedCatalog,
        locale,
      })
    : null;
  const triggerLabel =
    triggerModelText !== null
      ? t('chat.orchestrator.chipActive', { model: triggerModelText })
      : t('chat.orchestrator.chipOff');

  const commitConfig = (patch: {
    enabled?: boolean;
    accountId?: string;
    model?: string | null;
    effort?: EffortLevel | null;
    maxRounds?: number;
  }) => {
    const nextAccountId = patch.accountId ?? selectedAccount.id;
    const nextModel = patch.model !== undefined ? patch.model : activeModelValue;
    const targetCatalog = (() => {
      const targetAcc = accounts.find((account) => account.id === nextAccountId);
      return targetAcc
        ? (modelsByAccount[targetAcc.label] ?? PROVIDER_MODELS[targetAcc.provider])
        : catalog;
    })();
    const nextEfforts = effortsForModel(targetCatalog, nextModel);
    const candidateEffort = patch.effort !== undefined ? patch.effort : activeEffortValue;
    const nextEffort =
      candidateEffort !== null && nextEfforts.includes(candidateEffort) ? candidateEffort : null;
    const targetChanged =
      orchestrator !== null &&
      (orchestrator.accountId !== nextAccountId || orchestrator.model !== nextModel);
    onChange({
      enabled: patch.enabled ?? true,
      accountId: nextAccountId,
      model: nextModel,
      effort: nextEffort,
      maxRounds: patch.maxRounds ?? activeRounds,
      providerSessionId: targetChanged ? null : (orchestrator?.providerSessionId ?? null),
    });
  };

  const applyCustomModel = () => {
    if (normalizedCustom === null) return;
    commitConfig({ enabled: true, model: normalizedCustom });
    setCustomDraft('');
    setOpen(false);
  };

  const onCustomKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyCustomModel();
  };

  return (
    <div className="chat-picker" ref={containerRef}>
      <button
        type="button"
        className={[
          'chat-picker-trigger',
          isOpen ? 'chat-picker-trigger-open' : '',
          isEnabled ? 'chat-picker-trigger-active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={t('chat.orchestrator.triggerAria')}
        data-tooltip={t('chat.orchestrator.triggerTooltip')}
        onClick={() => {
          setDraftAccountId(orchestrator?.accountId ?? activeAccountId ?? selectedAccount.id);
          setOpen((current) => !current);
        }}
      >
        <CompareIcon size={14} />
        <span className="chat-picker-trigger-label">{triggerLabel}</span>
        <span className="chat-picker-chevron">
          <ChevronDownIcon size={12} />
        </span>
      </button>

      {isOpen ? (
        <div
          className="chat-picker-popover chat-orchestrator-popover"
          role="dialog"
          aria-label={t('chat.orchestrator.dialogAria')}
        >
          <div className="chat-picker-section">
            <div className="chat-picker-title">{t('chat.orchestrator.dialogTitle')}</div>
            <p className="chat-orchestrator-desc">{t('chat.orchestrator.dialogDesc')}</p>
          </div>

          <div className="chat-picker-section">
            <div className="chat-picker-title">{t('chat.orchestrator.accountLabel')}</div>
            <select
              className="chat-orchestrator-account-select"
              aria-label={t('chat.orchestrator.accountLabel')}
              value={selectedAccount.id}
              onChange={(event) => {
                const nextAccountId = event.target.value;
                setDraftAccountId(nextAccountId);
                commitConfig({
                  enabled: true,
                  accountId: nextAccountId,
                  model: null,
                  effort: null,
                });
              }}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {`${PROVIDER_NAME[account.provider]} · ${account.label}`}
                </option>
              ))}
            </select>
          </div>

          <div className="chat-picker-section">
            <div className="chat-picker-title">{t('chat.orchestrator.roundsLabel')}</div>
            <div
              className="chat-orchestrator-rounds"
              role="group"
              aria-label={t('chat.orchestrator.roundsLabel')}
            >
              {ROUND_CHOICES.map((count) => {
                const selected = activeRounds === count;
                return (
                  <button
                    key={count}
                    type="button"
                    className={selected ? 'chat-effort-btn active' : 'chat-effort-btn'}
                    aria-pressed={selected}
                    onClick={() => commitConfig({ enabled: true, maxRounds: count })}
                  >
                    {t('chat.orchestrator.roundsCount', { count })}
                  </button>
                );
              })}
            </div>
          </div>

          {availableEfforts.length > 0 ? (
            <div className="chat-picker-section">
              <div className="chat-picker-title">{t('picker.effortTitle')}</div>
              <div className="chat-effort-group" role="group" aria-label={t('picker.effortTitle')}>
                {availableEfforts.map((level) => {
                  const active = activeEffort === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      className={active ? 'chat-effort-btn active' : 'chat-effort-btn'}
                      aria-pressed={active}
                      onClick={() => commitConfig({ enabled: true, effort: level })}
                    >
                      {effortLabel(level, locale)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="chat-picker-section">
            <div className="chat-picker-title">{t('chat.orchestrator.modelLabel')}</div>
            <div
              className="chat-model-list"
              role="listbox"
              aria-label={t('chat.orchestrator.modelLabel')}
            >
              {modelOptions.map((option) => {
                const optionValue = option.id === '' ? null : option.id;
                const selected = isEnabled && sameAccountAsSaved && activeModel === optionValue;
                return (
                  <button
                    key={option.id || '__default__'}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={selected ? 'chat-model-item active' : 'chat-model-item'}
                    onClick={() => {
                      commitConfig({ enabled: true, model: optionValue });
                      setOpen(false);
                    }}
                  >
                    <span className="chat-model-item-main">
                      <span className="chat-model-item-label">{option.label}</span>
                      {option.description ? (
                        <span className="chat-model-item-desc">{option.description}</span>
                      ) : null}
                    </span>
                    {selected ? (
                      <span className="chat-model-item-check">
                        <CheckIcon size={14} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="chat-model-custom">
            <input
              type="text"
              className="chat-model-custom-input"
              placeholder={t('picker.customModelIdPlaceholder')}
              aria-label={t('picker.customModel')}
              value={customDraft}
              onChange={(event) => setCustomDraft(event.target.value)}
              onKeyDown={onCustomKeyDown}
            />
            <button
              type="button"
              className="chat-model-custom-btn"
              disabled={normalizedCustom === null}
              onClick={applyCustomModel}
            >
              {t('picker.customModelUse')}
            </button>
          </div>

          {isEnabled ? (
            <div className="chat-mode-footer">
              <button
                type="button"
                className="chat-mode-default-btn"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                {t('chat.orchestrator.disableBtn')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
