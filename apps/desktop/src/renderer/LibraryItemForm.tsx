import { useEffect, useRef, type FormEvent } from 'react';
import { useI18n } from './I18nContext';
import type { LibraryFormState } from './library-form';
import { KindFields, TextField } from './LibraryKindFields';
import './library.css';

interface LibraryItemFormProps {
  form: LibraryFormState;
  error: string | null;
  saving: boolean;
  onChange: (form: LibraryFormState) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function LibraryItemForm(props: LibraryItemFormProps) {
  const { form, error, saving, onChange, onSubmit, onCancel } = props;
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const patch = (next: Partial<LibraryFormState>) => onChange({ ...form, ...next });
  const kindLabel = t(`library.kindOne.${form.kind}`);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!saving) onSubmit();
  };

  return (
    <form className="library-form" onSubmit={submit} aria-labelledby="library-form-title">
      <h4 id="library-form-title" ref={headingRef} tabIndex={-1} className="library-form-title">
        {t(form.editing ? 'library.form.titleEdit' : 'library.form.titleNew', { kind: kindLabel })}
      </h4>
      <TextField
        id="library-form-id"
        label={t('library.form.id')}
        value={form.id}
        hint={t('library.form.idHint')}
        mono
        disabled={form.editing}
        onChange={(id) => patch({ id })}
      />
      <TextField
        id="library-form-name"
        label={t('library.form.name')}
        value={form.name}
        onChange={(name) => patch({ name })}
      />
      <TextField
        id="library-form-description"
        label={t('library.form.description')}
        value={form.description}
        onChange={(description) => patch({ description })}
      />
      <KindFields form={form} onChange={patch} />
      <label className="modal-check">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(event) => patch({ enabled: event.target.checked })}
        />
        <span>{t('library.form.enabled')}</span>
      </label>
      {error ? (
        <p className="library-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="library-form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
