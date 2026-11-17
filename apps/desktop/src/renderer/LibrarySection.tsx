import { useState } from 'react';
import type { AccountView, LibraryItem, ProjectView } from '../shared/api';
import { ConfirmModal } from './ConfirmModal';
import { useI18n } from './I18nContext';
import {
  ENV_VALUE_EXAMPLE,
  FORM_ERROR_KEYS,
  buildSaveInput,
  emptyForm,
  formFromItem,
  toggleInput,
  type LibraryFormState,
} from './library-form';
import { LIBRARY_KINDS, groupLibraryItems, libraryIdTaken, recipeFor } from './library-state';
import { LibraryItemForm } from './LibraryItemForm';
import { LibraryItemRow } from './LibraryItemRow';
import type { RunCommand } from './LibraryPluginInstall';
import { LibrarySyncPanel } from './LibrarySyncPanel';
import { SettingGroup } from './settings-controls';
import { libraryCall, useLibrary } from './useLibrary';
import './library.css';

interface LibrarySectionProps {
  accounts: readonly AccountView[];
  projects: readonly ProjectView[];
  onRun: RunCommand;
}

export function LibrarySection({ accounts, projects, onRun }: LibrarySectionProps) {
  const { locale, t } = useI18n();
  const { listing, loadError, reload } = useLibrary(locale);
  const [form, setForm] = useState<LibraryFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<LibraryItem | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);

  const refresh = async () => {
    await reload();
    setLibraryVersion((version) => version + 1);
  };

  const openForm = (next: LibraryFormState) => {
    setFormError(null);
    setForm(next);
  };

  const submit = async () => {
    if (!form) return;
    const built = buildSaveInput(form);
    if (!built.ok) {
      setFormError(
        t(FORM_ERROR_KEYS[built.code], { key: built.detail ?? '', example: ENV_VALUE_EXAMPLE }),
      );
      return;
    }
    if (!form.editing && libraryIdTaken({ items: listing?.items ?? [], id: built.input.id })) {
      setFormError(t('library.error.idExists'));
      return;
    }
    setSaving(true);
    setFormError(null);
    const result = await libraryCall({
      action: () => window.inova.saveLibraryItem(built.input),
      locale,
    });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setForm(null);
    await refresh();
  };

  const toggle = async (item: LibraryItem, enabled: boolean) => {
    setPendingId(item.id);
    setRowError(null);
    const result = await libraryCall({
      action: () => window.inova.saveLibraryItem(toggleInput(item, enabled)),
      locale,
    });
    setPendingId(null);
    if (result.ok) await refresh();
    else setRowError(result.message);
  };

  const confirmRemove = async () => {
    const target = removing;
    setRemoving(null);
    if (!target) return;
    setRowError(null);
    const result = await libraryCall({
      action: () => window.inova.removeLibraryItem({ id: target.id }),
      locale,
    });
    if (result.ok) await refresh();
    else setRowError(result.message);
  };

  const groups = listing ? groupLibraryItems(listing.items) : [];

  return (
    <>
      <SettingGroup description={t('library.intro')}>
        <div className="library-new">
          {LIBRARY_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="btn btn-sm"
              onClick={() => openForm(emptyForm(kind))}
            >
              {t('library.newButton', { kind: t(`library.kindOne.${kind}`) })}
            </button>
          ))}
        </div>
      </SettingGroup>
      {form ? (
        <LibraryItemForm
          key={form.editing ? `edit-${form.id}` : `new-${form.kind}`}
          form={form}
          error={formError}
          saving={saving}
          onChange={setForm}
          onSubmit={() => void submit()}
          onCancel={() => setForm(null)}
        />
      ) : null}
      {loadError ? (
        <p className="library-error" role="alert">
          {t('library.loadFailed', { message: loadError })}
        </p>
      ) : null}
      {rowError ? (
        <p className="library-error" role="alert">
          {rowError}
        </p>
      ) : null}
      {listing && groups.length === 0 ? <p className="library-hint">{t('library.empty')}</p> : null}
      {!listing && !loadError ? <p className="library-hint">{t('common.loading')}</p> : null}
      {groups.map((group) => (
        <SettingGroup key={group.kind} title={t(`capabilities.tab.${group.kind}`)}>
          <ul className="library-list">
            {group.items.map((item) => (
              <LibraryItemRow
                key={item.id}
                item={item}
                recipe={recipeFor(listing?.pluginRecipes, item.id)}
                accounts={accounts}
                pending={pendingId === item.id}
                onToggle={(target, enabled) => void toggle(target, enabled)}
                onEdit={(target) => openForm(formFromItem(target))}
                onRemove={setRemoving}
                onRun={onRun}
              />
            ))}
          </ul>
        </SettingGroup>
      ))}
      <LibrarySyncPanel projects={projects} accounts={accounts} libraryVersion={libraryVersion} />
      {removing ? (
        <ConfirmModal
          title={t('library.remove.title')}
          description={t('library.remove.description', { name: removing.name })}
          confirmLabel={t('library.remove')}
          danger
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </>
  );
}
