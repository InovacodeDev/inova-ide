import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ExecutionMode, ProviderId, Settings, SettingsPatch } from '@inova/core/types';
import { CloseIcon } from './icons';
import { useI18n } from './I18nContext';
import { openModalCount } from './modal-layers';
import {
  SETTINGS_SECTIONS,
  moveSection,
  settingsSectionLabel,
  type SettingsSectionId,
} from './settings-sections';
import {
  GeneralSection,
  NotificationsSection,
  SessionsSection,
  ShortcutsSection,
} from './SettingsSections';
import { ModelsSection } from './SettingsModels';
import { VoiceSection } from './SettingsVoice';
import { useDialogFocus } from './useDialogFocus';
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
  const { locale, t } = useI18n();
  const [active, setActive] = useState<SettingsSectionId>('general');
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useDialogFocus(cardRef);

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
    general: <GeneralSection settings={settings} onUpdate={onUpdate} call={call} />,
    models: (
      <ModelsSection
        settings={settings}
        defaultModes={defaultModes}
        onUpdate={onUpdate}
        onSetDefaultMode={onSetDefaultMode}
      />
    ),
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
              {t('settings.title')}
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('settings.close')}
            data-tooltip={t('settings.close')}
            data-shortcut="dismiss"
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
            aria-label={t('settings.navLabel')}
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
                {settingsSectionLabel(section.id, locale)}
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
              <h3 className="settings-panel-title">{settingsSectionLabel(section.id, locale)}</h3>
              {panels[section.id]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
