import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { effortsForModel, splitModelEffortVariant, type ProviderModels } from '@inova/core/models';
import type { EffortLevel } from '@inova/core/types';
import { CheckIcon, ChevronDownIcon } from './icons';
import { useI18n } from './I18nContext';
import {
  effortLabel,
  formatPickerLabel,
  normalizeCustomModelInput,
  resolveModelOptions,
} from './model-picker-state';

export interface ModelEffortPickerProps {
  model: string | null;
  effort: EffortLevel | null;
  catalog: ProviderModels;
  disabled?: boolean;
  openRequest?: number;
  onChange: (patch: { model?: string | null; effort?: EffortLevel | null }) => void;
}

export function ModelEffortPicker({
  model,
  effort,
  catalog,
  disabled = false,
  openRequest = 0,
  onChange,
}: ModelEffortPickerProps) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const isOpen = open && !disabled;

  const handledOpenRequestRef = useRef(openRequest);
  useEffect(() => {
    if (openRequest === handledOpenRequestRef.current) return;
    handledOpenRequestRef.current = openRequest;
    setOpen(true);
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

  const split = splitModelEffortVariant(catalog, model);
  const activeModel = split.model;
  const availableEfforts = effortsForModel(catalog, activeModel);
  const activeEffort = effort ?? split.effort;
  const triggerLabel = formatPickerLabel({ model, effort, catalog, locale });
  const modelOptions = resolveModelOptions({ model, catalog, locale });
  const normalizedCustom = normalizeCustomModelInput(customDraft);

  const applyModelSelection = (nextModel: string | null) => {
    const nextEfforts = effortsForModel(catalog, nextModel);
    if (effort !== null && !nextEfforts.includes(effort)) {
      onChange({ model: nextModel, effort: null });
    } else {
      onChange({ model: nextModel });
    }
    setOpen(false);
  };

  const applyCustomModel = () => {
    if (normalizedCustom === null) return;
    applyModelSelection(normalizedCustom);
    setCustomDraft('');
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
        className={isOpen ? 'chat-picker-trigger chat-picker-trigger-open' : 'chat-picker-trigger'}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={t('picker.selectAria')}
        data-tooltip={t('picker.selectTooltip')}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="chat-picker-chevron">
          <ChevronDownIcon size={14} />
        </span>
        <span className="chat-picker-trigger-label">{triggerLabel}</span>
      </button>

      {isOpen ? (
        <div className="chat-picker-popover" role="dialog" aria-label={t('picker.dialogAria')}>
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
                      onClick={() => onChange({ effort: level })}
                    >
                      {effortLabel(level, locale)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="chat-picker-section">
            <div className="chat-picker-title">{t('picker.modelGroupHeading')}</div>
            <div
              className="chat-model-list"
              role="listbox"
              aria-label={t('picker.availableModelsAria')}
            >
              {modelOptions.map((option) => {
                const optionValue = option.id === '' ? null : option.id;
                const selected = activeModel === optionValue;
                return (
                  <button
                    key={option.id || '__default__'}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={selected ? 'chat-model-item active' : 'chat-model-item'}
                    onClick={() => applyModelSelection(optionValue)}
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
        </div>
      ) : null}
    </div>
  );
}
