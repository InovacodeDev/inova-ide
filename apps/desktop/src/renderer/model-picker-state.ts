import { type ModelOption, type ProviderModels } from '@inova/core/models';
import type { EffortLevel, SupportedLocale } from '@inova/core/types';
import { translate } from './i18n';

const MAX_CUSTOM_MODEL_LENGTH = 200;

const MODEL_DESCRIPTION_EN: Record<string, string> = {
  sonnet: 'Balanced for everyday use',
  opus: 'Deep reasoning and complex tasks',
  fable: 'Demanding reasoning and long autonomous sessions',
  haiku: 'Fast and cost-effective',
  opusplan: 'Opus 5.5 for planning, Sonnet 5.5 for execution',
  'gpt-6.2-astra': 'Frontier intelligence for demanding tasks',
  'gpt-6.2-sol': 'Latest for coding and everyday use',
  'gpt-6.1-sol': 'Balanced for coding and agentic workflows',
  'gpt-6-astra': 'Previous frontier generation',
  'gpt-6-sol': 'Previous generation for engineering and code',
  'gpt-6-luna': 'Fast and affordable for simple tasks',
  'gpt-5.6-terra': 'Balanced for straightforward tasks',
  'gpt-5.6-luna': 'Fast and efficient',
  'deepseek-flash': 'Fast multimodal with 1M context and reasoning',
  'deepseek-v4-pro': 'Flagship MoE for deep reasoning and architecture',
  'kimi-k3.1-pro': 'Flagship multimodal with 1M context and reasoning',
  'kimi-k3.1-pro-highspeed': 'K3.1 Pro with 2-3x faster generation',
  'kimi-k3': 'Open multimodal model with 1M context',
  'kimi-for-coding': 'Optimized for agentic coding tasks',
  'grok-4.7': 'Flagship for complex coding and long-running agents',
  'grok-4.6': 'Interactive agents, coding, and visual tasks',
  'grok-4.20-reasoning': 'Deep reasoning with long context',
  'grok-4.20-non-reasoning': 'High speed and low latency for direct tasks',
  'qwen4-max': 'Flagship multimodal with 1M context and reasoning',
  'qwen3.8-max': 'High-capacity MoE for complex engineering',
  'qwen3.8-flash': 'Fast and cost-effective for edits and agents',
  'qwen3.6-plus': 'Balanced with enhanced reasoning',
  'qwen3-coder-plus': 'Long context for repositories',
  'opencode/claude-sonnet-5-5': 'Via OpenCode Zen',
  'opencode/claude-opus-5-5': 'Via OpenCode Zen',
  'opencode/gpt-6.2-sol': 'Via OpenCode Zen',
  'opencode/gpt-6.2-astra': 'Via OpenCode Zen',
  'opencode/gemini-4-hydrogen': 'Via OpenCode Zen',
  'opencode/gemini-4-carbon': 'Via OpenCode Zen',
  'opencode/deepseek-v4.1-flash': 'Via OpenCode Zen',
  'opencode/deepseek-v4.1-flash-free': 'Free via OpenCode Zen',
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
