import {
  EFFORT_LEVELS,
  PROVIDER_MODELS,
  effortsForModel,
  splitModelEffortVariant,
  type ModelOption,
  type ProviderModels,
} from '@inova/core/models';
import { PROVIDER_MODES } from '@inova/core/modes';
import type {
  EffortLevel,
  ExecutionMode,
  ProviderId,
  Settings,
  SettingsPatch,
} from '@inova/core/types';
import type { AccountView } from '../shared/api';
import { useI18n } from './I18nContext';
import { effectiveModeForSession, modeOptionText } from './mode-picker-state';
import { effortLabel, resolveModelOptions } from './model-picker-state';
import { PlatformSelect } from './PlatformSelect';
import { PROVIDER_NAME } from './provider-meta';
import { SettingGroup, SettingRow } from './settings-controls';

const PROVIDERS = Object.keys(PROVIDER_MODES) as ProviderId[];

export function resolveProviderCatalog(
  provider: ProviderId,
  accounts?: readonly Pick<AccountView, 'label' | 'provider'>[],
  modelsByAccount?: Readonly<Record<string, ProviderModels>>,
): ProviderModels {
  const fallback = PROVIDER_MODELS[provider];
  if (!accounts || !modelsByAccount) return fallback;
  const catalogs = accounts
    .filter((account) => account.provider === provider)
    .map((account) => modelsByAccount[account.label])
    .filter((catalog): catalog is ProviderModels => catalog !== undefined);
  if (catalogs.length === 0) return fallback;
  if (catalogs.length === 1 && catalogs[0]) return catalogs[0];
  const seen = new Set<string>();
  const models: ModelOption[] = [];
  for (const catalog of catalogs) {
    for (const model of catalog.models) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      models.push(model);
    }
  }
  const effortSet = new Set<EffortLevel>();
  for (const catalog of catalogs) {
    for (const effort of catalog.efforts) effortSet.add(effort);
  }
  return {
    defaultModelLabel: catalogs[0]?.defaultModelLabel ?? fallback.defaultModelLabel,
    models,
    efforts: EFFORT_LEVELS.filter((level) => effortSet.has(level)),
  };
}

export function ModelsSection(props: {
  settings: Settings;
  defaultModes: Partial<Record<ProviderId, ExecutionMode>>;
  accounts?: readonly Pick<AccountView, 'label' | 'provider'>[];
  modelsByAccount?: Readonly<Record<string, ProviderModels>>;
  onUpdate: (patch: SettingsPatch) => void;
  onSetDefaultMode: (provider: ProviderId, mode: ExecutionMode) => void;
}) {
  const { settings, defaultModes, accounts, modelsByAccount, onUpdate, onSetDefaultMode } = props;
  const { locale, t } = useI18n();
  return (
    <>
      {PROVIDERS.map((provider) => {
        const catalog = resolveProviderCatalog(provider, accounts, modelsByAccount);
        const modes = PROVIDER_MODES[provider];
        const current = settings.models[provider];
        const split = splitModelEffortVariant(catalog, current.model);
        const normalizedModel = split.model;
        const availableEfforts = effortsForModel(catalog, normalizedModel);
        const effectiveEffort = availableEfforts.includes(current.effort)
          ? current.effort
          : split.effort !== null && availableEfforts.includes(split.effort)
            ? split.effort
            : availableEfforts.includes('medium')
              ? 'medium'
              : (availableEfforts[0] ?? current.effort);
        const name = PROVIDER_NAME[provider];
        return (
          <SettingGroup key={provider} title={name} description={t('settings.models.providerDesc')}>
            <SettingRow
              title={t('settings.models.modelTitle')}
              description={t('settings.models.modelDesc')}
            >
              <PlatformSelect
                ariaLabel={t('settings.models.modelAria', { provider: name })}
                value={normalizedModel ?? ''}
                options={resolveModelOptions({ model: current.model, catalog, locale }).map(
                  (option) => ({
                    value: option.id,
                    label: option.label,
                    ...(option.description ? { description: option.description } : {}),
                  }),
                )}
                onChange={(value) => {
                  const nextModel = value === '' ? null : value;
                  const nextEfforts = effortsForModel(catalog, nextModel);
                  const nextEffort =
                    nextEfforts.length === 0 || nextEfforts.includes(current.effort)
                      ? current.effort
                      : nextEfforts.includes('medium')
                        ? 'medium'
                        : (nextEfforts[0] ?? current.effort);
                  onUpdate({
                    models: { [provider]: { model: nextModel, effort: nextEffort } },
                  });
                }}
              />
            </SettingRow>
            {availableEfforts.length > 0 ? (
              <SettingRow
                title={t('settings.models.effortTitle')}
                description={t('settings.models.effortDesc')}
              >
                <PlatformSelect
                  ariaLabel={t('settings.models.effortAria', { provider: name })}
                  value={effectiveEffort}
                  options={availableEfforts.map((level) => ({
                    value: level,
                    label: effortLabel(level, locale),
                  }))}
                  onChange={(value) =>
                    onUpdate({
                      models: {
                        [provider]: { model: normalizedModel, effort: value as EffortLevel },
                      },
                    })
                  }
                />
              </SettingRow>
            ) : null}
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
