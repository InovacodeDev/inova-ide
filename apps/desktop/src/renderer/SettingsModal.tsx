import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ExecutionMode, ProviderId, Settings, SettingsPatch } from '@inova/core/types';
import { CloseIcon } from './icons';
import { openModalCount } from './modal-layers';
import { SETTINGS_SECTIONS, moveSection, type SettingsSectionId } from './settings-sections';
import {
  AppearanceSection,
  GeneralSection,
  NotificationsSection,
  SessionsSection,
  ShortcutsSection,
} from './SettingsSections';
import { VoiceSection } from './SettingsVoice';
import type { WarningCall } from './useWarning';
import './modal.css';
import './settings.css';

interface SettingsModalProps {
  settings: Settings;
  defaultModes: Partial<Record<ProviderId, ExecutionMode>>;
  isMac: boolean;
  call: WarningCall;
  onUpdate: (patch: SettingsPatch) => void;
  onSetDefaultMode: (provider: ProviderId, mode: ExecutionMode) => void;
  onClose: () => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const { settings, defaultModes, isMac, call, onUpdate, onSetDefaultMode, onClose } = props;
  const [active, setActive] = useState<SettingsSectionId>('general');
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    cardRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    // NOTE: nested layers (confirm modal, open select menu) register their own Esc handler after
    // this one, so this handler must skip Esc while one of them is open.
    const hasNestedLayer = () =>
      openModalCount() > 1 || (cardRef.current?.querySelector('.select-menu') ?? null) !== null;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || hasNestedLayer()) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onNavKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = moveSection({ current: active, delta: event.key === 'ArrowDown' ? 1 : -1 });
    setActive(next);
    event.currentTarget.querySelector<HTMLElement>(`#settings-tab-${next}`)?.focus();
  };

  const panels: Record<SettingsSectionId, ReactNode> = {
    general: (
      <GeneralSection defaultModes={defaultModes} call={call} onSetDefaultMode={onSetDefaultMode} />
    ),
    appearance: <AppearanceSection settings={settings} onUpdate={onUpdate} />,
    sessions: <SessionsSection settings={settings} onUpdate={onUpdate} />,
    notifications: <NotificationsSection settings={settings} onUpdate={onUpdate} call={call} />,
    voice: <VoiceSection settings={settings} onUpdate={onUpdate} call={call} />,
    shortcuts: <ShortcutsSection isMac={isMac} />,
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={cardRef} className="modal-card settings-card" tabIndex={-1}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 id="settings-title" className="modal-title">
              Configurações
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar configurações"
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="settings-layout">
          <div
            className="settings-nav"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Seções das configurações"
            onKeyDown={onNavKeyDown}
          >
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                role="tab"
                id={`settings-tab-${section.id}`}
                aria-selected={section.id === active}
                aria-controls={`settings-panel-${section.id}`}
                tabIndex={section.id === active ? 0 : -1}
                className={
                  section.id === active
                    ? 'settings-nav-item settings-nav-active'
                    : 'settings-nav-item'
                }
                onClick={() => setActive(section.id)}
              >
                {section.label}
              </button>
            ))}
          </div>
          {SETTINGS_SECTIONS.map((section) => (
            <div
              key={section.id}
              role="tabpanel"
              id={`settings-panel-${section.id}`}
              aria-labelledby={`settings-tab-${section.id}`}
              className="settings-panel"
              hidden={section.id !== active}
            >
              <h3 className="settings-panel-title">{section.label}</h3>
              {panels[section.id]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
