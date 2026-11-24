import { useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { AccountView, LibraryItem, ProjectView } from '../shared/api';
import { presetAction, presetHelp, type PresetHelp } from './connector-catalog';
import { ConfirmModal } from './ConfirmModal';
import { ConnectorPicker } from './ConnectorPicker';
import { McpJsonImportModal } from './McpJsonImportModal';
import { DownloadIcon } from './icons';
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
import {
  LIBRARY_TABS,
  extractDroppedFiles,
  hasFileDragPayload,
  itemsForTab,
  libraryIdTaken,
  libraryTabCounts,
  recipeFor,
  resolveDroppedLibraryZips,
  summarizeZipImportBatch,
  type LibraryTabId,
  type ZipBatchItemOutcome,
} from './library-state';
import { LibraryItemForm } from './LibraryItemForm';
import { LibraryItemRow } from './LibraryItemRow';
import type { RunCommand } from './LibraryPluginInstall';
import { LibrarySyncPanel } from './LibrarySyncPanel';
import { SettingGroup } from './settings-controls';
import { handleHorizontalTabListKeyDown } from './tablist-nav';
import { libraryCall, useLibrary } from './useLibrary';
import './capabilities.css';
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
  const [zipNotice, setZipNotice] = useState<string | null>(null);
  const [importingZip, setImportingZip] = useState(false);
  const [draggingZip, setDraggingZip] = useState(false);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<LibraryTabId>('skill');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [formHelp, setFormHelp] = useState<PresetHelp | null>(null);
  const dragDepthRef = useRef(0);
  const importingZipRef = useRef(false);

  const refresh = async () => {
    await reload();
    setLibraryVersion((version) => version + 1);
  };

  const importZipPaths = async (input: {
    zipPaths: readonly string[];
    extraErrors?: readonly string[];
  }) => {
    if (importingZipRef.current || input.zipPaths.length === 0) return;
    importingZipRef.current = true;
    setImportingZip(true);
    setRowError(null);
    setZipNotice(null);

    const outcomes: ZipBatchItemOutcome[] = [];
    try {
      for (const zipPath of input.zipPaths) {
        const fileName = zipPath.replace(/^.*[/\\]/, '');
        const result = await libraryCall({
          action: () => window.inova.importLibraryZip({ zipPath }),
          locale,
        });
        if (result.ok) {
          outcomes.push({
            fileName,
            ok: true,
            itemName: result.value.item.name,
            replaced: result.value.replaced,
          });
        } else {
          outcomes.push({ fileName, ok: false, message: result.message });
        }
      }
    } finally {
      importingZipRef.current = false;
      setImportingZip(false);
    }

    const summary = summarizeZipImportBatch(outcomes);
    const extraErrors = input.extraErrors ?? [];
    const errorMessages = [
      ...summary.failures.map((failure) =>
        summary.importedNames.length === 0 &&
        summary.failures.length === 1 &&
        extraErrors.length === 0
          ? failure.message
          : t('library.importZipPartialError', {
              name: failure.fileName,
              message: failure.message,
            }),
      ),
      ...extraErrors,
    ];
    if (errorMessages.length > 0) {
      setRowError(errorMessages.join(' '));
    }

    if (summary.importedNames.length === 1) {
      const name = summary.importedNames[0];
      if (name !== undefined) {
        setZipNotice(
          t(summary.replacedSingle ? 'library.importZipReplaced' : 'library.importZipSuccess', {
            name,
          }),
        );
      }
    } else if (summary.importedNames.length > 1) {
      setZipNotice(
        t('library.importZipBatchSuccess', {
          count: summary.importedNames.length,
          names: summary.importedNames.join(', '),
        }),
      );
    }

    if (summary.importedNames.length > 0) {
      await refresh();
    }
  };

  const importZip = async () => {
    if (importingZipRef.current) return;
    setRowError(null);
    setZipNotice(null);
    const picked = await libraryCall({ action: () => window.inova.pickLibraryZip(), locale });
    if (!picked.ok) {
      setRowError(picked.message);
      return;
    }
    if (picked.value === null) return;
    await importZipPaths({ zipPaths: [picked.value] });
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileDragPayload(event.dataTransfer.types)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setDraggingZip(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileDragPayload(event.dataTransfer.types)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = importingZipRef.current ? 'none' : 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileDragPayload(event.dataTransfer.types)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDraggingZip(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDraggingZip(false);
    if (!hasFileDragPayload(event.dataTransfer.types) || importingZipRef.current) return;

    const files = extractDroppedFiles(event.dataTransfer);
    const resolution = resolveDroppedLibraryZips({
      files,
      resolvePath: (entry) =>
        typeof window.inova?.getPathForFile === 'function'
          ? window.inova.getPathForFile(entry.file)
          : '',
    });

    switch (resolution.kind) {
      case 'empty':
        return;
      case 'invalid-files':
        setZipNotice(null);
        setRowError(t('library.dropZip.invalidFiles'));
        return;
      case 'unresolvable':
        setZipNotice(null);
        setRowError(t('library.dropZip.unresolvable'));
        return;
      case 'too-many':
        setZipNotice(null);
        setRowError(t('library.dropZip.tooMany', { max: resolution.max }));
        return;
      case 'ready': {
        const extraErrors: string[] = [];
        if (resolution.rejectedNames.length > 0) {
          extraErrors.push(
            t('library.dropZip.ignoredFiles', { names: resolution.rejectedNames.join(', ') }),
          );
        }
        if (resolution.unresolvableCount > 0) {
          extraErrors.push(t('library.dropZip.unresolvable'));
        }
        void importZipPaths({ zipPaths: resolution.zipPaths, extraErrors });
        return;
      }
    }
  };

  const openForm = (next: LibraryFormState) => {
    setFormError(null);
    setFormHelp(null);
    setForm(next);
  };

  const pickPreset = (presetId: string) => {
    setPickerOpen(false);
    const action = presetAction(listing?.items ?? [], presetId);
    if (!action) return;
    openForm(action.kind === 'edit' ? formFromItem(action.item) : action.form);
    setFormHelp(presetHelp(presetId));
  };

  const existingIds = useMemo(() => (listing?.items ?? []).map((item) => item.id), [listing]);

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

  const removeInvalid = async (id: string) => {
    setPendingId(id);
    setRowError(null);
    const result = await libraryCall({
      action: () => window.inova.removeLibraryItem({ id }),
      locale,
    });
    setPendingId(null);
    if (result.ok) await refresh();
    else setRowError(result.message);
  };

  const allItems = listing?.items ?? [];
  const counts = libraryTabCounts(allItems);
  const invalidItems = listing?.invalidItems ?? [];

  return (
    <div
      className={draggingZip ? 'library-section library-section-dragging' : 'library-section'}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {draggingZip ? (
        <div className="library-drop-overlay" aria-hidden="true">
          <DownloadIcon size={28} />
          <span>{t('library.dropZip.overlay')}</span>
        </div>
      ) : null}
      <SettingGroup description={t('library.intro')}>
        <div className="library-new">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={importingZip}
            onClick={() => void importZip()}
          >
            <DownloadIcon size={14} />
            <span>{t(importingZip ? 'library.importingZip' : 'library.importZip')}</span>
          </button>
        </div>
        <button
          type="button"
          className={draggingZip ? 'library-dropzone library-dropzone-active' : 'library-dropzone'}
          disabled={importingZip}
          onClick={() => void importZip()}
        >
          <DownloadIcon size={16} />
          <span>{t(importingZip ? 'library.importingZip' : 'library.dropZip.hint')}</span>
        </button>
      </SettingGroup>
      {zipNotice ? (
        <p className="library-notice" role="status">
          {zipNotice}
        </p>
      ) : null}
      {form && formHelp ? (
        <p className="library-hint" role="note">
          {formHelp.kind === 'token'
            ? t('connectors.help.token', { var: formHelp.envVar })
            : t(formHelp.kind === 'oauth' ? 'connectors.help.oauth' : 'connectors.help.custom')}
        </p>
      ) : null}
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
      {invalidItems.length > 0 ? (
        <SettingGroup title={t('library.invalid.title')}>
          <p className="library-warning" role="alert">
            {t('library.invalid.warning')}
          </p>
          <ul className="library-list">
            {invalidItems.map((entry) => (
              <li key={entry.id} className="library-row">
                <div className="library-row-main">
                  <div className="library-row-text">
                    <span className="library-row-name mono">{entry.id}</span>
                    <span className="library-row-desc">{entry.error}</span>
                  </div>
                  <div className="library-row-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={pendingId === entry.id}
                      aria-label={t('library.removeAria', { name: entry.id })}
                      onClick={() => void removeInvalid(entry.id)}
                    >
                      {t('library.remove')}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </SettingGroup>
      ) : null}
      {listing && allItems.length === 0 && invalidItems.length === 0 ? (
        <p className="library-hint">{t('library.empty')}</p>
      ) : null}
      {!listing && !loadError ? <p className="library-hint">{t('common.loading')}</p> : null}
      <div
        className="capabilities-tabs library-tabs"
        role="tablist"
        aria-label={t('library.tabsAria')}
        onKeyDown={(event) =>
          handleHorizontalTabListKeyDown({
            event,
            ids: LIBRARY_TABS.map((tab) => tab.id),
            activeId: activeTab,
            onSelect: setActiveTab,
          })
        }
      >
        {LIBRARY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`library-tab-${tab.id}`}
            aria-selected={tab.id === activeTab}
            aria-controls={`library-panel-${tab.id}`}
            tabIndex={tab.id === activeTab ? 0 : -1}
            className="capabilities-tab"
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{t(`library.tab.${tab.id}`)}</span>
            <span className="capabilities-tab-count mono">{counts[tab.id]}</span>
          </button>
        ))}
      </div>
      {LIBRARY_TABS.map((tab) => {
        const tabItems = itemsForTab(allItems, tab.id);
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`library-panel-${tab.id}`}
            aria-labelledby={`library-tab-${tab.id}`}
            hidden={tab.id !== activeTab}
          >
            <SettingGroup>
              <div className="library-new">
                {tab.kinds.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="btn btn-sm"
                    onClick={() => openForm(emptyForm(kind))}
                  >
                    {t('library.newButton', { kind: t(`library.kindOne.${kind}`) })}
                  </button>
                ))}
                {tab.id === 'mcp' ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setPickerOpen(true)}
                    >
                      {t('connectors.add')}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setJsonOpen(true)}>
                      {t('connectors.json.button')}
                    </button>
                  </>
                ) : null}
              </div>
              {tab.id === 'mcp' ? <p className="library-hint">{t('connectors.hint')}</p> : null}
              {listing && tabItems.length === 0 ? (
                <p className="library-hint">{t('library.tabEmpty')}</p>
              ) : null}
              {tabItems.length > 0 ? (
                <ul className="library-list">
                  {tabItems.map((item) => (
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
              ) : null}
            </SettingGroup>
          </div>
        );
      })}
      <LibrarySyncPanel projects={projects} accounts={accounts} libraryVersion={libraryVersion} />
      {pickerOpen ? (
        <ConnectorPicker
          existingIds={new Set(existingIds)}
          onPick={pickPreset}
          onCancel={() => setPickerOpen(false)}
        />
      ) : null}
      {jsonOpen ? (
        <McpJsonImportModal
          existingIds={existingIds}
          onClose={() => setJsonOpen(false)}
          onSaved={refresh}
        />
      ) : null}
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
    </div>
  );
}
