import { EFFORT_LABEL, type ModelOption, type ProviderModels } from '@inova/core/models';
import type { EffortLevel } from '@inova/core/types';

const MAX_CUSTOM_MODEL_LENGTH = 200;

export function formatPickerLabel(input: {
  model: string | null;
  effort: EffortLevel | null;
  catalog: ProviderModels;
}): string {
  const { model, effort, catalog } = input;
  const matched = model === null ? undefined : catalog.models.find((item) => item.id === model);
  const modelLabel = model === null ? catalog.defaultModelLabel : (matched?.label ?? model);
  const effortLabel = effort === null ? catalog.defaultEffortLabel : EFFORT_LABEL[effort];
  return `${modelLabel} (${effortLabel})`;
}

export function resolveModelOptions(input: {
  model: string | null;
  catalog: ProviderModels;
}): ModelOption[] {
  const { model, catalog } = input;
  const options: ModelOption[] = [
    { id: '', label: catalog.defaultModelLabel, description: 'Usar padrão do provedor' },
    ...catalog.models,
  ];
  if (model !== null && !catalog.models.some((item) => item.id === model)) {
    options.push({ id: model, label: model, description: 'Modelo customizado' });
  }
  return options;
}

export function normalizeCustomModelInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > MAX_CUSTOM_MODEL_LENGTH) return null;
  return trimmed;
}
