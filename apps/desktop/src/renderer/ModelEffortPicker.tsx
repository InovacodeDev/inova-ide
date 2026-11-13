import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { EFFORT_LABEL, type ProviderModels } from '@inova/core/models';
import type { EffortLevel } from '@inova/core/types';
import { CheckIcon, ChevronDownIcon } from './icons';
import {
  formatPickerLabel,
  normalizeCustomModelInput,
  resolveModelOptions,
} from './model-picker-state';

export interface ModelEffortPickerProps {
  model: string | null;
  effort: EffortLevel | null;
  catalog: ProviderModels;
  disabled?: boolean;
  onChange: (patch: { model?: string | null; effort?: EffortLevel | null }) => void;
}

export function ModelEffortPicker({
  model,
  effort,
  catalog,
  disabled = false,
  onChange,
}: ModelEffortPickerProps) {
  const [open, setOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const isOpen = open && !disabled;

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

  const triggerLabel = formatPickerLabel({ model, effort, catalog });
  const modelOptions = resolveModelOptions({ model, catalog });
  const normalizedCustom = normalizeCustomModelInput(customDraft);

  const selectModel = (nextModel: string | null) => {
    onChange({ model: nextModel });
    setOpen(false);
  };

  const applyCustomModel = () => {
    if (normalizedCustom === null) return;
    onChange({ model: normalizedCustom });
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
        className={isOpen ? 'chat-picker-trigger chat-picker-trigger-open' : 'chat-picker-trigger'}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Selecionar modelo e nível de esforço"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="chat-picker-chevron">
          <ChevronDownIcon size={14} />
        </span>
        <span className="chat-picker-trigger-label">{triggerLabel}</span>
      </button>

      {isOpen ? (
        <div className="chat-picker-popover" role="dialog" aria-label="Modelo e nível de esforço">
          <div className="chat-picker-section">
            <div className="chat-picker-title">Nível de esforço</div>
            <div className="chat-effort-group" role="group" aria-label="Nível de esforço">
              <button
                type="button"
                className={effort === null ? 'chat-effort-btn active' : 'chat-effort-btn'}
                aria-pressed={effort === null}
                onClick={() => onChange({ effort: null })}
              >
                {catalog.defaultEffortLabel}
              </button>
              {catalog.efforts.map((level) => {
                const active = effort === level;
                return (
                  <button
                    key={level}
                    type="button"
                    className={active ? 'chat-effort-btn active' : 'chat-effort-btn'}
                    aria-pressed={active}
                    onClick={() => onChange({ effort: level })}
                  >
                    {EFFORT_LABEL[level]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="chat-picker-section">
            <div className="chat-picker-title">Modelo</div>
            <div className="chat-model-list" role="listbox" aria-label="Modelos disponíveis">
              {modelOptions.map((option) => {
                const optionValue = option.id === '' ? null : option.id;
                const selected = model === optionValue;
                return (
                  <button
                    key={option.id || '__default__'}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={selected ? 'chat-model-item active' : 'chat-model-item'}
                    onClick={() => selectModel(optionValue)}
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
              placeholder="ID do modelo customizado…"
              aria-label="Modelo customizado"
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
              Usar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
