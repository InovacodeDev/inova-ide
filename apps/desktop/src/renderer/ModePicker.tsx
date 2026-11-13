import { useEffect, useRef, useState } from 'react';
import { PROVIDER_MODES } from '@inova/core/modes';
import type { ExecutionMode, ProviderId } from '@inova/core/types';
import {
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  ListTodoIcon,
  LockIcon,
  PencilIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
} from './icons';
import {
  effectiveModeForSession,
  findModeOption,
  isRiskyBypassMode,
  optionByShortcutKey,
} from './mode-picker-state';
import { PROVIDER_NAME } from './provider-meta';

export interface ModePickerProps {
  provider: ProviderId;
  sessionMode: ExecutionMode | null;
  defaultModes: Partial<Record<ProviderId, ExecutionMode>>;
  inWorktree?: boolean;
  disabled?: boolean;
  onChangeMode: (mode: ExecutionMode) => void;
  onSetDefault: (mode: ExecutionMode) => void;
}

function ModeOptionIcon({ mode, risky }: { mode: ExecutionMode; risky?: boolean }) {
  switch (mode) {
    case 'auto':
      return <ShieldCheckIcon size={14} />;
    case 'manual':
      return <LockIcon size={14} />;
    case 'accept-edits':
      return <PencilIcon size={14} />;
    case 'plan':
      return <ListTodoIcon size={14} />;
    case 'bypass':
      return risky ? <ShieldAlertIcon size={14} /> : <ShieldIcon size={14} />;
    case 'read-only':
      return <EyeIcon size={14} />;
  }
}

export function ModePicker({
  provider,
  sessionMode,
  defaultModes,
  inWorktree = false,
  disabled = false,
  onChangeMode,
  onSetDefault,
}: ModePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isOpen = open && !disabled;

  const catalog = PROVIDER_MODES[provider];
  const effectiveMode = effectiveModeForSession({ provider, sessionMode, defaultModes });
  const activeOption = findModeOption(provider, effectiveMode);
  const riskyBypass = isRiskyBypassMode(effectiveMode, inWorktree);
  const isAlreadyProviderDefault = defaultModes[provider] === effectiveMode;

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const node = containerRef.current;
      if (node !== null && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const chosen = optionByShortcutKey(provider, event.key);
      if (chosen) {
        event.preventDefault();
        onChangeMode(chosen.id);
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onChangeMode, provider]);

  return (
    <div className="chat-picker" ref={containerRef}>
      <button
        type="button"
        className={[
          'chat-picker-trigger',
          isOpen ? 'chat-picker-trigger-open' : '',
          riskyBypass ? 'chat-mode-trigger-risky' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Selecionar modo de execução"
        data-tooltip={
          riskyBypass
            ? `${activeOption.label}: executando sem restrições fora de worktree isolado`
            : activeOption.description
        }
        onClick={() => setOpen((current) => !current)}
      >
        <ModeOptionIcon mode={effectiveMode} risky={riskyBypass} />
        <span className="chat-picker-trigger-label">{activeOption.label}</span>
        <span className="chat-picker-chevron">
          <ChevronDownIcon size={12} />
        </span>
      </button>

      {isOpen ? (
        <div
          className="chat-picker-popover chat-mode-popover"
          role="dialog"
          aria-label={catalog.title}
        >
          <div className="chat-picker-section">
            <div className="chat-picker-title">{catalog.title}</div>
            <div className="chat-mode-list">
              {catalog.options.map((option, index) => {
                const selected = option.id === effectiveMode;
                const optionRisky = isRiskyBypassMode(option.id, inWorktree);
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={selected ? 'chat-mode-option selected' : 'chat-mode-option'}
                    aria-pressed={selected}
                    onClick={() => {
                      onChangeMode(option.id);
                      setOpen(false);
                    }}
                  >
                    <span className={optionRisky ? 'chat-mode-icon risky' : 'chat-mode-icon'}>
                      <ModeOptionIcon mode={option.id} risky={optionRisky} />
                    </span>
                    <span className="chat-mode-copy">
                      <span className="chat-mode-head">
                        <span className="chat-mode-label">{option.label}</span>
                        {option.badge ? (
                          <span className="chat-mode-badge">{option.badge}</span>
                        ) : null}
                      </span>
                      <span className="chat-mode-desc">{option.description}</span>
                      {option.headlessNote ? (
                        <span className="chat-mode-note">{option.headlessNote}</span>
                      ) : null}
                    </span>
                    <span className="chat-mode-meta">
                      {selected ? <CheckIcon size={14} /> : null}
                      <span className="chat-mode-key">{index + 1}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="chat-mode-footer">
            <button
              type="button"
              className="chat-mode-default-btn"
              disabled={isAlreadyProviderDefault}
              onClick={() => {
                onSetDefault(effectiveMode);
                setOpen(false);
              }}
            >
              {isAlreadyProviderDefault
                ? `Padrão salvo para ${PROVIDER_NAME[provider]}`
                : `Definir como padrão para ${PROVIDER_NAME[provider]}`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
