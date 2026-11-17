import { useI18n } from './I18nContext';
import { CloseIcon, PlusIcon } from './icons';
import { ENV_VALUE_EXAMPLE, SECRET_HELP_EXAMPLE, type KeyValueRow } from './library-form';
import './library.css';

interface KeyValueFieldsProps {
  title: string;
  addLabel: string;
  rows: readonly KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
}

export function KeyValueFields({ title, addLabel, rows, onChange }: KeyValueFieldsProps) {
  const { t } = useI18n();
  const update = (index: number, patch: Partial<KeyValueRow>) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  const remove = (index: number) => onChange(rows.filter((_, position) => position !== index));

  return (
    <fieldset className="library-fieldset">
      <legend className="modal-field-label">{title}</legend>
      <p className="library-hint">
        {t('library.form.secretHelp', { example: SECRET_HELP_EXAMPLE })}
      </p>
      {rows.map((row, index) => (
        <div key={index} className="library-pair">
          <input
            type="text"
            className="field library-pair-key mono"
            value={row.key}
            placeholder={t('library.form.pairKey')}
            aria-label={t('library.form.pairKeyAria', { group: title, index: index + 1 })}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <input
            type="text"
            className="field library-pair-value mono"
            value={row.value}
            placeholder={ENV_VALUE_EXAMPLE}
            aria-label={t('library.form.pairValueAria', { group: title, index: index + 1 })}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <button
            type="button"
            className="icon-btn library-pair-remove"
            aria-label={t('library.form.pairRemoveAria', { group: title, index: index + 1 })}
            data-tooltip={t('common.remove')}
            onClick={() => remove(index)}
          >
            <CloseIcon size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-sm library-add-pair"
        onClick={() => onChange([...rows, { key: '', value: '' }])}
      >
        <PlusIcon size={13} />
        {addLabel}
      </button>
    </fieldset>
  );
}
