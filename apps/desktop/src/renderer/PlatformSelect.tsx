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
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && focusedIndex >= 0) {
      optionRefs.current[focusedIndex]?.focus();
    }
  }, [open, focusedIndex]);

  const selected = options.find((option) => option.value === value) ?? null;

  const initialOptionIndex = (key: string): number => {
    const selectedIndex = options.findIndex((option) => option.value === value);
    if (key === 'Home') return 0;
    if (key === 'End') return options.length - 1;
    if (selectedIndex >= 0) return selectedIndex;
    return key === 'ArrowUp' ? options.length - 1 : 0;
  };

  const nextOptionIndex = (currentIndex: number, key: string): number => {
    if (key === 'Home') return 0;
    if (key === 'End') return options.length - 1;
    const delta = key === 'ArrowUp' ? -1 : 1;
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    return (startIndex + delta + options.length) % options.length;
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || options.length === 0) return;
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setFocusedIndex(initialOptionIndex(event.key));
      } else {
        setFocusedIndex((current) => nextOptionIndex(current, event.key));
      }
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (options.length === 0) return;
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.preventDefault();
      setFocusedIndex((current) => nextOptionIndex(current, event.key));
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="select-root">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={open ? 'select-trigger select-trigger-open' : 'select-trigger'}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() =>
          setOpen((current) => {
            const next = !current;
            setFocusedIndex(next ? options.findIndex((option) => option.value === value) : -1);
            return next;
          })
        }
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
        <div
          className="select-menu"
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={onMenuKeyDown}
        >
          {options.map((option, index) => {
            const active = option.value === value;
            const focused = index === focusedIndex;
            return (
              <button
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className={[
                  'select-option',
                  active ? 'select-option-selected' : '',
                  focused ? 'select-option-focused' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
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
