import type { LocalePreference, SupportedLocale } from '@inova/core/types';
import { CORE_EN_US, CORE_PT_BR } from './i18n/core';
import { MODALS_EN_US, MODALS_PT_BR } from './i18n/modals';
import { SETTINGS_EN_US, SETTINGS_PT_BR } from './i18n/settings';
import { WORKSPACE_EN_US, WORKSPACE_PT_BR } from './i18n/workspace';

export type { LocalePreference, SupportedLocale };
export type TranslationParams = Record<string, string | number>;

export function resolveLocale(
  preference: LocalePreference | undefined,
  systemLocale: string,
): SupportedLocale {
  if (preference === 'pt-BR' || preference === 'en-US') return preference;
  return /^en(?:-|$)/i.test(systemLocale) ? 'en-US' : 'pt-BR';
}

const PT_BR = {
  ...CORE_PT_BR,
  ...SETTINGS_PT_BR,
  ...MODALS_PT_BR,
  ...WORKSPACE_PT_BR,
} as const;

export type TranslationKey = keyof typeof PT_BR;

const EN_US: Record<TranslationKey, string> = {
  ...CORE_EN_US,
  ...SETTINGS_EN_US,
  ...MODALS_EN_US,
  ...WORKSPACE_EN_US,
};

export const MESSAGES: Record<SupportedLocale, Record<TranslationKey, string>> = {
  'pt-BR': PT_BR,
  'en-US': EN_US,
};

export function translate(
  locale: SupportedLocale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES['pt-BR'][key];
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : full,
  );
}
