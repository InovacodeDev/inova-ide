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
    <>
      {PROVIDERS.map((provider) => {
        const catalog = PROVIDER_MODELS[provider];
        const modes = PROVIDER_MODES[provider];
        const current = settings.models[provider];
        const name = PROVIDER_NAME[provider];
        return (
          <SettingGroup
            key={provider}
            title={name}
            description="Padrões usados quando a sessão não escolhe outro valor."
          >
            <SettingRow title="Modelo" description="Modelo que inicia novas sessões.">
              <PlatformSelect
                ariaLabel={`Modelo padrão: ${name}`}
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
            </SettingRow>
            <SettingRow title="Esforço" description="Quanto o modelo raciocina antes de responder.">
              <PlatformSelect
                ariaLabel={`Esforço padrão: ${name}`}
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
            <SettingRow title="Modo" description="Quanto o agente pode agir sem pedir aprovação.">
              <PlatformSelect
                ariaLabel={`Modo padrão: ${name}`}
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
            </SettingRow>
          </SettingGroup>
        );
      })}
    </>
  );
}
