import { useEffect, useRef, useState } from 'react';
import type { AccountView, ProfileSyncPreview, ProjectView } from '../shared/api';
import { useI18n } from './I18nContext';
import {
  applyableIds,
  canPreviewSync,
  selectionSummary,
  summarizeApply,
  syncAccountSelection,
  toggleId,
  type ApplySummary,
} from './library-state';
import { LibrarySyncItem } from './LibrarySyncItem';
import { PlatformSelect } from './PlatformSelect';
import { folderName } from './path-name';
import { ProviderBadge } from './ProviderBadge';
import { accountDisplayName } from './provider-meta';
import { SettingGroup } from './settings-controls';
import { libraryCall } from './useLibrary';
import './library.css';

interface LibrarySyncPanelProps {
  projects: readonly ProjectView[];
  accounts: readonly AccountView[];
  libraryVersion: number;
}

function ApplyResult({ result }: { result: ApplySummary }) {
  const { t } = useI18n();
  return (
    <div className="library-sync-result" role="status">
      <p>
        {t('library.sync.result', { applied: result.appliedCount, skipped: result.skippedCount })}
      </p>
      <p>
        {t('library.sync.backup')} <span className="mono">{result.backupDir}</span>
      </p>
      <IdList summary={t('library.sync.appliedList')} ids={result.appliedIds} />
      <IdList summary={t('library.sync.skippedList')} ids={result.skippedIds} />
    </div>
  );
}

function IdList({ summary, ids }: { summary: string; ids: readonly string[] }) {
  if (ids.length === 0) return null;
  return (
    <details>
      <summary>{summary}</summary>
      <ul className="library-skipped mono">
        {ids.map((id) => (
          <li key={id}>{id}</li>
        ))}
      </ul>
    </details>
  );
}

export function LibrarySyncPanel({ projects, accounts, libraryVersion }: LibrarySyncPanelProps) {
  const { locale, t } = useI18n();
  const [chosenProject, setChosenProject] = useState<string | null>(null);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<ProfileSyncPreview | null>(null);
  const [approvedIds, setApprovedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySummary | null>(null);
  const sequence = useRef(0);

  const projectId = projects.some((project) => project.id === chosenProject)
    ? chosenProject
    : (projects[0]?.id ?? null);
  const selection = syncAccountSelection({
    allIds: accounts.map((account) => account.id),
    excludedIds,
  });
  const canPreview = canPreviewSync({
    projectId,
    accountCount: accounts.length,
    selectedCount: selection.ids.length,
  });
  const items = preview?.items ?? [];
  const summary = selectionSummary({ items, approvedIds });

  const reset = () => {
    sequence.current += 1;
    setPreview(null);
    setApprovedIds([]);
    setResult(null);
    setError(null);
    setBusy(null);
  };

  useEffect(() => {
    sequence.current += 1;
    setPreview(null);
    setApprovedIds([]);
    setBusy(null);
  }, [libraryVersion]);

  const selectionInput = (id: string) => ({
    projectId: id,
    ...(selection.request ? { accountIds: selection.request } : {}),
  });

  const runPreview = async () => {
    if (projectId === null || !canPreview) return;
    sequence.current += 1;
    const mine = sequence.current;
    setBusy('preview');
    setError(null);
    const response = await libraryCall({
      action: () => window.inova.previewLibrarySync(selectionInput(projectId)),
      locale,
    });
    if (mine !== sequence.current) return;
    setBusy(null);
    setApprovedIds([]);
    if (response.ok) setPreview(response.value);
    else {
      setPreview(null);
      setError(response.message);
    }
  };

  const runApply = async () => {
    if (projectId === null || preview === null) return;
    sequence.current += 1;
    setBusy('apply');
    setError(null);
    const response = await libraryCall({
      action: () =>
        window.inova.applyLibrarySync({
          ...selectionInput(projectId),
          approvedIds: applyableIds({ items: preview.items, approvedIds }),
        }),
      locale,
    });
    if (!response.ok) {
      setBusy(null);
      setError(response.message);
      return;
    }
    setResult(summarizeApply(response.value));
    setBusy(null);
    await runPreview();
  };

  return (
    <SettingGroup title={t('library.sync.title')} description={t('library.sync.desc')}>
      {projects.length === 0 ? (
        <p className="library-hint">{t('library.sync.noProjects')}</p>
      ) : (
        <div className="library-sync-controls">
          <div className="modal-field">
            <span className="modal-field-label">{t('library.sync.project')}</span>
            <PlatformSelect
              ariaLabel={t('library.sync.project')}
              value={projectId ?? ''}
              disabled={busy !== null}
              options={projects.map((project) => ({
                value: project.id,
                label: folderName(project.path),
                description: project.path,
              }))}
              onChange={(value) => {
                setChosenProject(value);
                reset();
              }}
            />
          </div>
          <fieldset className="library-fieldset">
            <legend className="modal-field-label">{t('library.sync.accounts')}</legend>
            <div className="library-sync-accounts">
              {accounts.map((account) => (
                <label key={account.id} className="modal-check">
                  <input
                    type="checkbox"
                    checked={!excludedIds.includes(account.id)}
                    disabled={busy !== null}
                    onChange={() => {
                      setExcludedIds((current) => toggleId(current, account.id));
                      reset();
                    }}
                  />
                  <ProviderBadge provider={account.provider} size={16} />
                  <span>{accountDisplayName(account)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
      <div className="library-sync-actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canPreview || busy !== null}
          onClick={() => void runPreview()}
        >
          {busy === 'preview' ? t('library.sync.previewing') : t('library.sync.preview')}
        </button>
        {preview ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy !== null || summary.willApplyCount === 0}
            onClick={() => void runApply()}
          >
            {busy === 'apply'
              ? t('library.sync.applying')
              : t('library.sync.apply', { count: summary.willApplyCount })}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="library-error" role="alert">
          {error}
        </p>
      ) : null}
      {result ? <ApplyResult result={result} /> : null}
      {preview && items.length === 0 ? (
        <p className="library-hint">{t('library.sync.nothing')}</p>
      ) : null}
      {preview && items.length > 0 ? (
        <>
          <p className="library-hint" aria-live="polite">
            {t('library.sync.summary', {
              auto: summary.autoCount,
              approved: summary.approvedCount,
              pending: summary.pendingCount,
            })}
          </p>
          <ul className="library-sync-list">
            {items.map((item) => (
              <LibrarySyncItem
                key={item.id}
                item={item}
                approved={approvedIds.includes(item.id)}
                onToggle={(id) => setApprovedIds((current) => toggleId(current, id))}
              />
            ))}
          </ul>
        </>
      ) : null}
    </SettingGroup>
  );
}
