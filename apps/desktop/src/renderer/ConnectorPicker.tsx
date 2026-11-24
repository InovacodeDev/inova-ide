import { useEffect, useRef, useState } from 'react';
import {
  CUSTOM_PRESET_ID,
  PRESET_DESCRIPTION_KEYS,
  presetHelp,
  searchConnectorPresets,
  type CatalogPresetId,
} from './connector-catalog';
import { useI18n } from './I18nContext';
import { CloseIcon } from './icons';
import { useDialogFocus } from './useDialogFocus';
import './library.css';
import './modal.css';

interface ConnectorPickerProps {
  existingIds: ReadonlySet<string>;
  onPick: (presetId: string) => void;
  onCancel: () => void;
}

export function ConnectorPicker({ existingIds, onPick, onCancel }: ConnectorPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useDialogFocus(cardRef);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const presets = searchConnectorPresets(query);
  const showCustom =
    query.trim() === '' ||
    t('connectors.custom.name').toLowerCase().includes(query.trim().toLowerCase()) ||
    CUSTOM_PRESET_ID.includes(query.trim().toLowerCase());

  const badgeKey = (presetId: string) => {
    const help = presetHelp(presetId);
    if (help.kind === 'oauth') return 'connectors.badge.oauth' as const;
    if (help.kind === 'token') return 'connectors.badge.token' as const;
    return 'connectors.badge.custom' as const;
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connector-picker-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div ref={cardRef} tabIndex={-1} className="modal-card connector-picker-card">
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 id="connector-picker-title" className="modal-title">
              {t('connectors.picker.title')}
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('connectors.picker.close')}
            onClick={onCancel}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body">
          <input
            ref={searchRef}
            type="search"
            className="field"
            value={query}
            placeholder={t('connectors.picker.search')}
            aria-label={t('connectors.picker.search')}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="connector-picker-grid">
            {presets.map((preset) => {
              const added = existingIds.has(preset.id);
              const help = presetHelp(preset.id);
              return (
                <li key={preset.id}>
                  <button
                    type="button"
                    className="connector-picker-item"
                    onClick={() => onPick(preset.id)}
                  >
                    <span className="connector-picker-head">
                      <span className="library-row-name">{preset.name}</span>
                      <span className="capabilities-tab-count mono">{t(badgeKey(preset.id))}</span>
                    </span>
                    <span className="library-row-desc">
                      {t(PRESET_DESCRIPTION_KEYS[preset.id as CatalogPresetId])}
                    </span>
                    <span className="library-row-desc mono">
                      {help.kind === 'token' ? `\${${help.envVar}}` : new URL(preset.url).host}
                    </span>
                    {added ? (
                      <span className="library-row-state library-row-state-effective">
                        {t('connectors.picker.added')}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {showCustom ? (
              <li>
                <button
                  type="button"
                  className="connector-picker-item"
                  onClick={() => onPick(CUSTOM_PRESET_ID)}
                >
                  <span className="connector-picker-head">
                    <span className="library-row-name">{t('connectors.custom.name')}</span>
                    <span className="capabilities-tab-count mono">
                      {t('connectors.badge.custom')}
                    </span>
                  </span>
                  <span className="library-row-desc">{t('connectors.custom.desc')}</span>
                </button>
              </li>
            ) : null}
          </ul>
          {presets.length === 0 && !showCustom ? (
            <p className="library-hint">{t('connectors.picker.noMatch')}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
