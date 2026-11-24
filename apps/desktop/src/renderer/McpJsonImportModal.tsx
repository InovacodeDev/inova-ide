import { useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryItem, SaveLibraryItemInput } from '../shared/api';
import { useI18n } from './I18nContext';
import { CloseIcon } from './icons';
import {
  IMPORT_ENTRY_ERROR_KEYS,
  IMPORT_PARSE_ERROR_KEYS,
  IMPORT_WARNING_KEYS,
  parseMcpJson,
  type ImportEntry,
} from './mcp-json-import';
import { useDialogFocus } from './useDialogFocus';
import { libraryCall } from './useLibrary';
import './library.css';
import './modal.css';

interface McpJsonImportModalProps {
  existingIds: readonly string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

type SaveOutcome = { id: string; ok: true } | { id: string; ok: false; message: string };

export function McpJsonImportModal({ existingIds, onClose, onSaved }: McpJsonImportModalProps) {
  const { locale, t } = useI18n();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [outcomes, setOutcomes] = useState<SaveOutcome[] | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useDialogFocus(cardRef);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const parsed = useMemo(
    () => (text.trim() === '' ? null : parseMcpJson(text, { name, existingIds })),
    [text, name, existingIds],
  );

  const okEntries = parsed?.ok ? parsed.entries.filter((entry) => entry.ok) : [];

  const entryError = (entry: Extract<ImportEntry, { ok: false }>) =>
    t(IMPORT_ENTRY_ERROR_KEYS[entry.error], { detail: entry.detail ?? '' });

  const save = async () => {
    if (saving || okEntries.length === 0) return;
    setSaving(true);
    const results: SaveOutcome[] = [];
    for (const entry of okEntries) {
      const input: SaveLibraryItemInput = entry.input;
      const result = await libraryCall<LibraryItem>({
        action: () => window.inova.saveLibraryItem(input),
        locale,
      });
      results.push(
        result.ok
          ? { id: entry.id, ok: true }
          : { id: entry.id, ok: false, message: result.message },
      );
    }
    setSaving(false);
    setOutcomes(results);
    if (results.some((result) => result.ok)) await onSaved();
  };

  const variables = [
    ...new Set(okEntries.flatMap((entry) => entry.replacements.map((item) => item.variable))),
  ];

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mcp-json-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div ref={cardRef} tabIndex={-1} className="modal-card mcp-json-card">
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 id="mcp-json-title" className="modal-title">
              {t('connectors.json.title')}
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('connectors.json.close')}
            disabled={saving}
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-description">{t('connectors.json.description')}</p>
          <div className="modal-field">
            <label className="modal-field-label" htmlFor="mcp-json-text">
              {t('connectors.json.textareaLabel')}
            </label>
            <textarea
              id="mcp-json-text"
              ref={textareaRef}
              className="field mono mcp-json-textarea"
              rows={9}
              value={text}
              placeholder={t('connectors.json.placeholder')}
              spellCheck={false}
              disabled={saving || outcomes !== null}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          {parsed?.ok && parsed.needsName ? (
            <div className="modal-field">
              <label className="modal-field-label" htmlFor="mcp-json-name">
                {t('connectors.json.nameLabel')}
              </label>
              <input
                id="mcp-json-name"
                type="text"
                className="field mono"
                value={name}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="mcp-json-name-hint"
                onChange={(event) => setName(event.target.value)}
              />
              <p id="mcp-json-name-hint" className="library-hint">
                {t('connectors.json.nameHint')}
              </p>
            </div>
          ) : null}
          {parsed && !parsed.ok ? (
            <p className="library-error" role="alert">
              {t(IMPORT_PARSE_ERROR_KEYS[parsed.error])}
            </p>
          ) : null}
          {parsed?.ok && parsed.entries.length > 0 && outcomes === null ? (
            <div className="mcp-json-preview">
              <p className="modal-field-label">
                {t('connectors.json.preview', { count: parsed.entries.length })}
              </p>
              <ul className="library-list">
                {parsed.entries.map((entry) => (
                  <li key={`${entry.rawName}-${entry.id}`} className="library-row">
                    <div className="library-row-text">
                      <span className="library-row-name mono">{entry.id}</span>
                      {entry.ok ? (
                        <>
                          <span className="library-row-desc">
                            {t(`library.kindOne.${entry.kind}`)} · {entry.target}
                          </span>
                          {entry.warnings.map((warning) => (
                            <span key={warning.code} className="library-row-desc">
                              {t(IMPORT_WARNING_KEYS[warning.code], {
                                detail: warning.detail ?? '',
                              })}
                            </span>
                          ))}
                        </>
                      ) : (
                        <span className="library-error" role="alert">
                          {entryError(entry)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {variables.length > 0 ? (
                <div className="library-warning" role="status">
                  <p>{t('connectors.json.secretNotice')}</p>
                  <p>{t('connectors.json.varsTitle')}</p>
                  <ul>
                    {okEntries.flatMap((entry) =>
                      entry.replacements.map((item) => (
                        <li key={`${entry.id}-${item.scope}-${item.key}`}>
                          <code className="mono">{item.variable}</code>{' '}
                          {t('connectors.json.replacedAt', {
                            scope: t(`connectors.json.scope.${item.scope}`),
                            key: `${entry.id}/${item.key}`,
                          })}
                        </li>
                      )),
                    )}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          {outcomes ? (
            <ul className="library-list" aria-live="polite">
              {outcomes.map((outcome) => (
                <li
                  key={outcome.id}
                  className={outcome.ok ? 'library-notice' : 'library-error'}
                  role={outcome.ok ? 'status' : 'alert'}
                >
                  {outcome.ok
                    ? t('connectors.json.resultOk', { id: outcome.id })
                    : t('connectors.json.resultFail', {
                        id: outcome.id,
                        message: outcome.message,
                      })}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="modal-footer">
          {outcomes ? (
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t('connectors.json.close')}
            </button>
          ) : (
            <>
              <button type="button" className="btn" disabled={saving} onClick={onClose}>
                {t('connectors.json.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || okEntries.length === 0}
                onClick={() => void save()}
              >
                {saving
                  ? t('connectors.json.saving')
                  : t('connectors.json.save', { count: okEntries.length })}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
