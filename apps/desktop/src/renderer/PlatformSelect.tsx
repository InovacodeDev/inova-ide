import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon } from './icons';
import './modal.css';

export interface PlatformSelectOption {
  value: string;
  label: string;
  description?: string;
  leading?: ReactNode;
}

interface PlatformSelectProps {
  id?: string;
  ariaLabel?: string;
  value: string;
  options: readonly PlatformSelectOption[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}

export function PlatformSelect({
  id,
  ariaLabel,
  value,
  options,
  disabled = false,
  placeholder = 'Selecionar…',
  onChange,
}: PlatformSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selected = options.find((option) => option.value === value) ?? null;

  const moveSelection = (delta: number) => {
    if (options.length === 0) return;
    const currentIndex = options.findIndex((option) => option.value === value);
    const startIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (startIndex + delta + options.length) % options.length;
    const nextOption = options[nextIndex];
    if (nextOption) onChange(nextOption.value);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else moveSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      else moveSelection(-1);
    }
  };

  return (
    <div ref={rootRef} className="select-root">
      <button
        id={id}
        type="button"
        className={open ? 'select-trigger select-trigger-open' : 'select-trigger'}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="select-trigger-main">
          {selected?.leading}
          <span
            className={
              selected ? 'select-trigger-label' : 'select-trigger-label select-trigger-placeholder'
            }
          >
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <span className="select-chevron">
          <ChevronDownIcon size={14} />
        </span>
      </button>
      {open && !disabled && (
        <div className="select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className={active ? 'select-option select-option-selected' : 'select-option'}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="select-option-main">
                  {option.leading}
                  <span className="select-option-text">
                    <span className="select-option-label">{option.label}</span>
                    {option.description ? (
                      <span className="select-option-desc">{option.description}</span>
                    ) : null}
                  </span>
                </span>
                {active ? (
                  <span className="select-option-check">
                    <CheckIcon size={14} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
