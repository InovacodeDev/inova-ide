import { EFFORT_LABEL, PROVIDER_MODELS } from '@inova/core/models';
import { PROVIDER_MODES } from '@inova/core/modes';
import type { EffortLevel, ProviderId, Settings, SettingsPatch } from '@inova/core/types';
import { resolveModelOptions } from './model-picker-state';
import { PlatformSelect } from './PlatformSelect';
import { PROVIDER_NAME } from './provider-meta';
import { SettingGroup, SettingRow } from './settings-controls';

const PROVIDERS = Object.keys(PROVIDER_MODES) as ProviderId[];

export function ModelsSection(props: {
  settings: Settings;
  onUpdate: (patch: SettingsPatch) => void;
}) {
  const { settings, onUpdate } = props;
  return (
    <SettingGroup>
      {PROVIDERS.map((provider) => {
        const catalog = PROVIDER_MODELS[provider];
        const current = settings.models[provider];
        return (
          <SettingRow
            key={provider}
            title={PROVIDER_NAME[provider]}
            description="Usado quando a sessão não escolhe modelo ou esforço."
          >
            <PlatformSelect
              ariaLabel={`Modelo padrão: ${PROVIDER_NAME[provider]}`}
              value={current.model ?? ''}
              options={resolveModelOptions({ model: current.model, catalog }).map((option) => ({
                value: option.id,
                label: option.label,
                ...(option.description ? { description: option.description } : {}),
              }))}
              onChange={(value) =>
                onUpdate({
                  models: { [provider]: { ...current, model: value === '' ? null : value } },
                })
              }
            />
            <PlatformSelect
              ariaLabel={`Esforço padrão: ${PROVIDER_NAME[provider]}`}
              value={current.effort}
              options={catalog.efforts.map((level) => ({
                value: level,
                label: EFFORT_LABEL[level],
              }))}
              onChange={(value) =>
                onUpdate({ models: { [provider]: { ...current, effort: value as EffortLevel } } })
              }
            />
          </SettingRow>
        );
      })}
    </SettingGroup>
  );
}
