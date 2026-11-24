import type { SupportedLocale } from '@inova/core/types';
import { translate } from './i18n';

export type SettingsSectionId =
  | 'general'
  | 'models'
  | 'sessions'
  | 'notifications'
  | 'voice'
  | 'library'
  | 'github'
  | 'shortcuts';

export const SETTINGS_SECTIONS: readonly { id: SettingsSectionId; label: string }[] = [
  { id: 'general', label: 'Geral' },
  { id: 'models', label: 'Modelos' },
  { id: 'sessions', label: 'Sessões' },
  { id: 'notifications', label: 'Notificações' },
  { id: 'voice', label: 'Voz' },
  { id: 'library', label: 'Biblioteca' },
  { id: 'github', label: 'GitHub' },
  { id: 'shortcuts', label: 'Atalhos' },
];

export function settingsSectionLabel(
  id: SettingsSectionId,
  locale: SupportedLocale = 'pt-BR',
): string {
  return translate(locale, `settings.section.${id}`);
}

export function moveSection(input: {
  current: SettingsSectionId;
  delta: 1 | -1;
}): SettingsSectionId {
  const count = SETTINGS_SECTIONS.length;
  const index = SETTINGS_SECTIONS.findIndex((section) => section.id === input.current);
  return SETTINGS_SECTIONS[(index + input.delta + count) % count]?.id ?? input.current;
}
