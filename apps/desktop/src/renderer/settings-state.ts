import type { Settings, SettingsPatch } from '@inova/core/types';

function pickPatchedKeys<Section extends object>(
  current: Section,
  patch: Partial<Section> | undefined,
): Partial<Section> | undefined {
  if (patch === undefined) return undefined;
  const picked: Partial<Section> = {};
  for (const key of Object.keys(patch) as (keyof Section)[]) picked[key] = current[key];
  return picked;
}

export function applySettingsPatch(settings: Settings, patch: SettingsPatch): Settings {
  return {
    appearance: { ...settings.appearance, ...patch.appearance },
    voice: { ...settings.voice, ...patch.voice },
    sessions: { ...settings.sessions, ...patch.sessions },
    notifications: { ...settings.notifications, ...patch.notifications },
    models: { ...settings.models, ...patch.models },
  };
}

export function inverseSettingsPatch(settings: Settings, patch: SettingsPatch): SettingsPatch {
  return {
    appearance: pickPatchedKeys(settings.appearance, patch.appearance),
    voice: pickPatchedKeys(settings.voice, patch.voice),
    sessions: pickPatchedKeys(settings.sessions, patch.sessions),
    notifications: pickPatchedKeys(settings.notifications, patch.notifications),
    models: pickPatchedKeys(settings.models, patch.models),
  };
}
