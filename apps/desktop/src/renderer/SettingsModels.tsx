import { EFFORT_LABEL, PROVIDER_MODELS } from '@inova/core/models';
import { PROVIDER_MODES } from '@inova/core/modes';
import type {
  EffortLevel,
  ExecutionMode,
  ProviderId,
  Settings,
  SettingsPatch,
} from '@inova/core/types';
import { effectiveModeForSession } from './mode-picker-state';
import { resolveModelOptions } from './model-picker-state';
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
  return (
    <SettingGroup>
      {PROVIDERS.map((provider) => {
        const catalog = PROVIDER_MODELS[provider];
        const modes = PROVIDER_MODES[provider];
        const current = settings.models[provider];
        return (
          <SettingRow
            key={provider}
            title={PROVIDER_NAME[provider]}
            description="Usado quando a sessão não escolhe modelo, esforço ou modo."
          >
            <div className="settings-model-defaults">
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
              <PlatformSelect
                ariaLabel={`Modo padrão: ${PROVIDER_NAME[provider]}`}
                value={effectiveModeForSession({ provider, defaultModes })}
                options={modes.options.map((option) => ({
                  value: option.id,
                  label: option.label,
                  description: option.description,
                }))}
                onChange={(value) => {
                  const chosen = modes.options.find((option) => option.id === value);
                  if (chosen) onSetDefaultMode(provider, chosen.id);
                }}
              />
            </div>
          </SettingRow>
        );
      })}
    </SettingGroup>
  );
}
