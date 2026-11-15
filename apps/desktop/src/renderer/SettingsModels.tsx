import { PROVIDER_MODELS } from '@inova/core/models';
import { PROVIDER_MODES } from '@inova/core/modes';
import type {
  EffortLevel,
  ExecutionMode,
  ProviderId,
  Settings,
  SettingsPatch,
} from '@inova/core/types';
import { useI18n } from './I18nContext';
import { effectiveModeForSession, modeOptionText } from './mode-picker-state';
import { effortLabel, resolveModelOptions } from './model-picker-state';
import { PlatformSelect } from './PlatformSelect';
import { PROVIDER_NAME } from './provider-meta';
import { SettingGroup, SettingRow } from './settings-controls';

const PROVIDERS = Object.keys(PROVIDER_MODES) as ProviderId[];

export function ModelsSection(props: {
  settings: Settings;
  defaultModes: Partial<Record<ProviderId, ExecutionMode>>;
  onUpdate: (patch: SettingsPatch) => void;
  onSetDefaultMode: (provider: ProviderId, mode: ExecutionMode) => void;
}) {
  const { settings, defaultModes, onUpdate, onSetDefaultMode } = props;
  const { locale, t } = useI18n();
  return (
    <>
      {PROVIDERS.map((provider) => {
        const catalog = PROVIDER_MODELS[provider];
        const modes = PROVIDER_MODES[provider];
        const current = settings.models[provider];
        const name = PROVIDER_NAME[provider];
        return (
          <SettingGroup key={provider} title={name} description={t('settings.models.providerDesc')}>
            <SettingRow
              title={t('settings.models.modelTitle')}
              description={t('settings.models.modelDesc')}
            >
              <PlatformSelect
                ariaLabel={t('settings.models.modelAria', { provider: name })}
                value={current.model ?? ''}
                options={resolveModelOptions({ model: current.model, catalog, locale }).map(
                  (option) => ({
                    value: option.id,
                    label: option.label,
                    ...(option.description ? { description: option.description } : {}),
                  }),
                )}
                onChange={(value) =>
                  onUpdate({
                    models: { [provider]: { ...current, model: value === '' ? null : value } },
                  })
                }
              />
            </SettingRow>
            <SettingRow
              title={t('settings.models.effortTitle')}
              description={t('settings.models.effortDesc')}
            >
              <PlatformSelect
                ariaLabel={t('settings.models.effortAria', { provider: name })}
                value={current.effort}
                options={catalog.efforts.map((level) => ({
                  value: level,
                  label: effortLabel(level, locale),
                }))}
                onChange={(value) =>
                  onUpdate({ models: { [provider]: { ...current, effort: value as EffortLevel } } })
                }
              />
            </SettingRow>
            <SettingRow
              title={t('settings.models.modeTitle')}
              description={t('settings.models.modeDesc')}
            >
              <PlatformSelect
                ariaLabel={t('settings.models.modeAria', { provider: name })}
                value={effectiveModeForSession({ provider, defaultModes })}
                options={modes.options.map((option) => {
                  const text = modeOptionText(provider, option, locale);
                  return {
                    value: option.id,
                    label: text.label,
                    description: text.description,
                  };
                })}
                onChange={(value) => {
                  const chosen = modes.options.find((option) => option.id === value);
                  if (chosen) onSetDefaultMode(provider, chosen.id);
                }}
              />
            </SettingRow>
          </SettingGroup>
        );
      })}
    </>
  );
}
