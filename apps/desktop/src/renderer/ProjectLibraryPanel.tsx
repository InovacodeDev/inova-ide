import { useState } from 'react';
import type { LibraryItem, ProjectView } from '../shared/api';
import { useI18n } from './I18nContext';
import { projectItemRows, type ProjectItemStatus } from './library-state';
import { SettingGroup, Switch } from './settings-controls';
import type { TranslationKey } from './i18n';
import { libraryCall, useLibrary } from './useLibrary';
import './library.css';

const STATUS_KEYS: Record<ProjectItemStatus, TranslationKey> = {
  effective: 'library.project.effective',
  'project-off': 'library.project.projectOff',
  'library-off': 'library.project.libraryOff',
};

interface ProjectLibraryPanelProps {
  project: ProjectView;
  onDisabledChange: (disabled: string[]) => void;
}

export function ProjectLibraryPanel({ project, onDisabledChange }: ProjectLibraryPanelProps) {
  const { locale, t } = useI18n();
  const { listing, loadError } = useLibrary(locale);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectDisabled = project.libraryDisabled ?? [];
  const rows = listing ? projectItemRows({ items: listing.items, projectDisabled }) : [];

  const toggle = async (item: LibraryItem, active: boolean) => {
    setPendingId(item.id);
    setError(null);
    const response = await libraryCall({
      action: () =>
        window.inova.setProjectOverride({
          projectId: project.id,
          itemId: item.id,
          disabled: !active,
        }),
      locale,
    });
    setPendingId(null);
    if (response.ok) onDisabledChange(response.value.disabled);
    else setError(response.message);
  };

  return (
    <SettingGroup title={t('library.project.title')} description={t('library.project.desc')}>
      {loadError ? (
        <p className="library-error" role="alert">
          {t('library.loadFailed', { message: loadError })}
        </p>
      ) : null}
      {error ? (
        <p className="library-error" role="alert">
          {error}
        </p>
      ) : null}
      {listing && rows.length === 0 ? <p className="library-hint">{t('library.empty')}</p> : null}
      <ul className="library-list">
        {rows.map(({ item, status }) => {
          const switchId = `library-project-${item.id}`;
          return (
            <li key={item.id} className="library-row">
              <div className="library-row-main">
                <div className="library-row-text">
                  <label className="library-row-name" htmlFor={switchId}>
                    {item.name}
                  </label>
                  <span className="library-row-desc">
                    {[t(`library.kindOne.${item.kind}`), item.description]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {item.kind === 'skill' ? (
                    <span className="library-row-desc">{t('library.project.skillNote')}</span>
                  ) : null}
                </div>
                <div className="library-row-actions">
                  <span className={`library-row-state library-row-state-${status}`}>
                    {t(STATUS_KEYS[status])}
                  </span>
                  <Switch
                    id={switchId}
                    checked={!projectDisabled.includes(item.id)}
                    disabled={status === 'library-off' || pendingId === item.id}
                    onChange={(active) => void toggle(item, active)}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </SettingGroup>
  );
}
