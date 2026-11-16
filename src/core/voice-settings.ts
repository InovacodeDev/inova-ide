import type { Settings, VoiceModelId, VoicePolishMode } from './types.js';

export const VOICE_MODEL_IDS: readonly VoiceModelId[] = [
  'base',
  'small-q5_1',
  'medium-q5_0',
  'large-v3-turbo-q5_0',
];

export const VOICE_POLISH_MODES: readonly VoicePolishMode[] = ['off', 'clean', 'structured'];

export const DEFAULT_VOICE_POLISH_ENDPOINT = 'http://127.0.0.1:11434';

export function isPolishEndpointUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol !== 'http:') return false;
    return (
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '::1' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

export function resolveVoicePolishSettings(voice: Settings['voice']): {
  mode: VoicePolishMode;
  model: string;
  endpoint: string;
  customDictionary: string[];
} {
  return {
    mode: voice.polishMode ?? 'clean',
    model: voice.polishModel ?? '',
    endpoint: voice.polishEndpoint ?? DEFAULT_VOICE_POLISH_ENDPOINT,
    customDictionary: voice.customDictionary ?? [],
  };
}
