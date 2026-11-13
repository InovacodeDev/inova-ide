export type SettingsSectionId =
  'general' | 'models' | 'appearance' | 'sessions' | 'notifications' | 'voice' | 'shortcuts';

export const SETTINGS_SECTIONS: readonly { id: SettingsSectionId; label: string }[] = [
  { id: 'general', label: 'Geral' },
  { id: 'models', label: 'Modelos' },
  { id: 'appearance', label: 'Aparência' },
  { id: 'sessions', label: 'Sessões' },
  { id: 'notifications', label: 'Notificações' },
  { id: 'voice', label: 'Voz' },
  { id: 'shortcuts', label: 'Atalhos' },
];

export function moveSection(input: {
  current: SettingsSectionId;
  delta: 1 | -1;
}): SettingsSectionId {
  const count = SETTINGS_SECTIONS.length;
  const index = SETTINGS_SECTIONS.findIndex((section) => section.id === input.current);
  return SETTINGS_SECTIONS[(index + input.delta + count) % count]?.id ?? input.current;
}
