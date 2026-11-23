import { useState } from 'react';
import type { LibraryItem, ProjectLibraryBinding, ProjectView } from '../shared/api';
import { useI18n } from './I18nContext';
import {
  projectMcpConnectorRows,
  projectSkillPluginState,
  type ProjectItemStatus,
} from './library-state';
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
  onBindingsChange?: (bindings: ProjectLibraryBinding[]) => void;
}

export function ProjectLibraryPanel({
  project,
  onDisabledChange,
  onBindingsChange,
}: ProjectLibraryPanelProps) {
  const { locale, t } = useI18n();
  const { listing, loadError } = useLibrary(locale);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectDisabled = project.libraryDisabled ?? [];
  const items = listing?.items ?? [];
  const { imported, available } = projectSkillPluginState({
    items,
    bindings: project.libraryBindings ?? [],
  });
  const mcpRows = projectMcpConnectorRows({ items, projectDisabled });

  const setBinding = async (input: {
    itemId: string;
    enabled: boolean;
    disabledSkills?: string[];
  }) => {
    setPendingId(input.itemId);
    setError(null);
    const response = await libraryCall({
      action: () =>
        window.inova.setProjectLibraryBinding({
          projectId: project.id,
          itemId: input.itemId,
          enabled: input.enabled,
          ...(input.disabledSkills === undefined ? {} : { disabledSkills: input.disabledSkills }),
        }),
      locale,
    });
    setPendingId(null);
    if (response.ok) onBindingsChange?.(response.value.bindings);
    else setError(response.message);
  };

  const removeBinding = async (itemId: string) => {
    setPendingId(itemId);
    setError(null);
    const response = await libraryCall({
      action: () =>
        window.inova.removeProjectLibraryBinding({
          projectId: project.id,
          itemId,
        }),
      locale,
    });
    setPendingId(null);
    if (response.ok) onBindingsChange?.(response.value.bindings);
    else setError(response.message);
  };

  const toggleMcp = async (item: LibraryItem, active: boolean) => {
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
    <>
      <SettingGroup
        title={t('library.project.skillsTitle')}
        description={t('library.project.skillsDesc')}
      >
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
        {listing && imported.length === 0 ? (
          <p className="library-hint">{t('library.project.skillsEmpty')}</p>
        ) : null}
        <ul className="library-list">
          {imported.map(({ item, binding, status, packageSkills, packageCommands }) => {
            const switchId = `library-project-binding-${item.id}`;
            const disabledSkills = binding.disabledSkills ?? [];
            return (
              <li key={item.id} className="library-row">
                <div className="library-row-main">
                  <div className="library-row-text">
                    <label className="library-row-name" htmlFor={switchId}>
                      {item.name}
                    </label>
                    <span className="library-row-desc">
                      {[
                        t(`library.kindOne.${item.kind}`),
                        item.kind === 'skill' ? `/${item.id}` : null,
                        item.description,
                      ]
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
                      checked={binding.enabled}
                      disabled={status === 'library-off' || pendingId === item.id}
                      onChange={(enabled) => void setBinding({ itemId: item.id, enabled })}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={pendingId === item.id}
                      onClick={() => void removeBinding(item.id)}
                    >
                      {t('library.project.removeFromProject')}
                    </button>
                  </div>
                </div>
                {packageSkills.length > 0 ? (
                  <ul className="library-plugin-skills">
                    {packageSkills.map((skill) => {
                      const skillSwitchId = `library-project-skill-${item.id}-${skill.id}`;
                      return (
                        <li key={skill.id} className="library-plugin-skill-row">
                          <div className="library-row-text">
                            <label className="library-row-detail mono" htmlFor={skillSwitchId}>
                              /{skill.id}
                            </label>
                            {skill.description ? (
                              <span className="library-row-desc">{skill.description}</span>
                            ) : null}
                          </div>
                          <Switch
                            id={skillSwitchId}
                            checked={skill.enabled}
                            disabled={
                              !binding.enabled || status === 'library-off' || pendingId === item.id
                            }
                            onChange={(enabled) => {
                              const nextDisabled = enabled
                                ? disabledSkills.filter((id) => id !== skill.id)
                                : [...disabledSkills, skill.id];
                              void setBinding({
                                itemId: item.id,
                                enabled: binding.enabled,
                                disabledSkills: nextDisabled,
                              });
                            }}
                          />
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {packageCommands.length > 0 ? (
                  <div className="library-package-tags">
                    {packageCommands.map((cmd) => (
                      <span key={cmd.name} className="library-slash-tag mono">
                        /{cmd.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </SettingGroup>

      <SettingGroup title={t('library.project.availableTitle')}>
        {listing && available.length === 0 ? (
          <p className="library-hint">{t('library.project.availableEmpty')}</p>
        ) : null}
        <ul className="library-list">
          {available.map((item) => (
            <li key={item.id} className="library-row">
              <div className="library-row-main">
                <div className="library-row-text">
                  <span className="library-row-name">{item.name}</span>
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
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={pendingId === item.id}
                    onClick={() => void setBinding({ itemId: item.id, enabled: true })}
                  >
                    {t('library.project.import')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </SettingGroup>

      {mcpRows.length > 0 ? (
        <SettingGroup title={t('library.project.mcpTitle')} description={t('library.project.desc')}>
          <ul className="library-list">
            {mcpRows.map(({ item, status }) => {
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
                    </div>
                    <div className="library-row-actions">
                      <span className={`library-row-state library-row-state-${status}`}>
                        {t(STATUS_KEYS[status])}
                      </span>
                      <Switch
                        id={switchId}
                        checked={!projectDisabled.includes(item.id)}
                        disabled={status === 'library-off' || pendingId === item.id}
                        onChange={(active) => void toggleMcp(item, active)}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </SettingGroup>
      ) : null}
    </>
  );
}
