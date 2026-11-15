import { type ModelOption, type ProviderModels } from '@inova/core/models';
import type { EffortLevel, SupportedLocale } from '@inova/core/types';
import { translate } from './i18n';

const MAX_CUSTOM_MODEL_LENGTH = 200;

const MODEL_DESCRIPTION_EN: Record<string, string> = {
  sonnet: 'Balanced for everyday use',
  opus: 'Deep reasoning and complex tasks',
  haiku: 'Fast and cost-effective',
  fable: 'Long, autonomous sessions',
  opusplan: 'Opus 5.5 for planning, Sonnet 5.5 for execution',
  'gpt-6-astra': 'Frontier intelligence for demanding tasks',
  'gpt-6.1-sol': 'Latest for coding and everyday use',
  'gpt-6-sol': 'Previous generation for engineering and code',
  'gpt-6-luna': 'Fast and affordable for simple tasks',
  'gpt-5.6-terra': 'Balanced for straightforward tasks',
  'gpt-5.6-luna': 'Fast and efficient',
  'deepseek-chat': 'Everyday use and fast coding',
  'deepseek-reasoner': 'Deep reasoning and architecture',
  'deepseek-v3': 'Previous stable model',
  'kimi-k2.5': 'Multimodal agent and advanced coding',
  'kimi-k2-thinking': 'Extended reasoning',
  'kimi-k2': 'Balanced and fast',
  'grok-4': 'Reasoning and advanced engineering',
  'grok-code-fast-1': 'Specialized in low-latency coding',
  'grok-3-mini': 'Lightweight and cost-effective',
  'qwen3-coder-plus': 'Long context for repositories',
  'qwen3-coder-flash': 'Fast edits',
  'qwen3-235b-a22b': 'MoE model for complex tasks',
  'opencode/zen-pro': 'Multi-provider routing',
  'anthropic/claude-sonnet-4-5': 'Via OpenCode',
  'openai/gpt-5': 'Via OpenCode',
};

export function effortLabel(effort: EffortLevel, locale: SupportedLocale = 'pt-BR'): string {
  return translate(locale, `effort.${effort}`);
}

export function defaultModelLabel(
  catalog: ProviderModels,
  locale: SupportedLocale = 'pt-BR',
): string {
  if (locale === 'en-US' && catalog.defaultModelLabel === 'Padrão') return 'Default';
  return catalog.defaultModelLabel;
}

export function localizeModelOption(
  option: ModelOption,
  locale: SupportedLocale = 'pt-BR',
): ModelOption {
  if (locale !== 'en-US' || !option.description) return option;
  const translated = MODEL_DESCRIPTION_EN[option.id];
  return translated ? { ...option, description: translated } : option;
}

export function formatPickerLabel(input: {
  model: string | null;
  effort: EffortLevel | null;
  catalog: ProviderModels;
  locale?: SupportedLocale;
}): string {
  const { model, effort, catalog, locale = 'pt-BR' } = input;
  const matched = model === null ? undefined : catalog.models.find((item) => item.id === model);
  const modelLabel =
    model === null ? defaultModelLabel(catalog, locale) : (matched?.label ?? model);
  return effort === null ? modelLabel : `${modelLabel} (${effortLabel(effort, locale)})`;
}

export function resolveModelOptions(input: {
  model: string | null;
  catalog: ProviderModels;
  locale?: SupportedLocale;
}): ModelOption[] {
  const { model, catalog, locale = 'pt-BR' } = input;
  const options: ModelOption[] = [
    {
      id: '',
      label: defaultModelLabel(catalog, locale),
      description: translate(locale, 'picker.providerDefault'),
    },
    ...catalog.models.map((item) => localizeModelOption(item, locale)),
  ];
  if (model !== null && !catalog.models.some((item) => item.id === model)) {
    options.push({
      id: model,
      label: model,
      description: translate(locale, 'picker.customModel'),
    });
  }
  return options;
}

export function normalizeCustomModelInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > MAX_CUSTOM_MODEL_LENGTH) return null;
  return trimmed;
}
