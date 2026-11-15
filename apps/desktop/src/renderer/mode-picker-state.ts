import { PROVIDER_MODES, resolveExecutionMode, type ProviderModeOption } from '@inova/core/modes';
import type { ExecutionMode, ProviderId, SupportedLocale } from '@inova/core/types';
import { MESSAGES, translate, type TranslationKey } from './i18n';

export function effectiveModeForSession(input: {
  provider: ProviderId;
  sessionMode?: ExecutionMode | null;
  defaultModes?: Partial<Record<ProviderId, ExecutionMode>>;
}): ExecutionMode {
  return resolveExecutionMode(input);
}

export function findModeOption(provider: ProviderId, mode: ExecutionMode): ProviderModeOption {
  const catalog = PROVIDER_MODES[provider];
  return catalog.options.find((opt) => opt.id === mode) ?? catalog.options[0]!;
}

export function optionByShortcutKey(provider: ProviderId, key: string): ProviderModeOption | null {
  if (!/^[1-9]$/.test(key)) return null;
  const index = Number(key) - 1;
  return PROVIDER_MODES[provider].options[index] ?? null;
}

export function isRiskyBypassMode(mode: ExecutionMode, inWorktree: boolean): boolean {
  return mode === 'bypass' && !inWorktree;
}

export function modeCatalogTitle(provider: ProviderId, locale: SupportedLocale = 'pt-BR'): string {
  const key = `mode.${provider}.title` as TranslationKey;
  return key in MESSAGES[locale] ? translate(locale, key) : PROVIDER_MODES[provider].title;
}

export function modeOptionText(
  provider: ProviderId,
  option: ProviderModeOption,
  locale: SupportedLocale = 'pt-BR',
): { label: string; description: string; badge?: string; headlessNote?: string } {
  const labelKey = `mode.${provider}.${option.id}.label` as TranslationKey;
  const descKey = `mode.${provider}.${option.id}.desc` as TranslationKey;
  const label = labelKey in MESSAGES[locale] ? translate(locale, labelKey) : option.label;
  const description = descKey in MESSAGES[locale] ? translate(locale, descKey) : option.description;
  const badge = option.badge ? translate(locale, `mode.badge.${option.badge}`) : undefined;
  const headlessNote = option.headlessNote ? translate(locale, 'mode.headlessNote') : undefined;
  return {
    label,
    description,
    ...(badge !== undefined ? { badge } : {}),
    ...(headlessNote !== undefined ? { headlessNote } : {}),
  };
}
