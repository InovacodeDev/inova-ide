import { loadStore, saveStore, withStoreLock } from './store.js';
import { PROVIDER_MODELS, isEffortLevel, isEffortSupported } from './models.js';
import type {
  LocalePreference,
  ProviderId,
  RateLimitFailoverPolicy,
  Settings,
  SettingsPatch,
} from './types.js';
import {
  DEFAULT_VOICE_POLISH_ENDPOINT,
  VOICE_MODEL_IDS,
  VOICE_POLISH_MODES,
  isPolishEndpointUrl,
  resolveVoicePolishSettings,
} from './voice-settings.js';

export {
  DEFAULT_VOICE_POLISH_ENDPOINT,
  VOICE_MODEL_IDS,
  VOICE_POLISH_MODES,
  isPolishEndpointUrl,
  resolveVoicePolishSettings,
};

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

const MAX_POLISH_MODEL_LENGTH = 120;
const MAX_DICTIONARY_ITEMS = 100;
const MAX_DICTIONARY_ITEM_LENGTH = 80;

export const RATE_LIMIT_FAILOVER_POLICIES: readonly RateLimitFailoverPolicy[] = [
  'off',
  'same-provider',
  'any-provider',
];

export const LOCALE_PREFERENCES: readonly LocalePreference[] = ['auto', 'pt-BR', 'en-US'];

export const DEFAULT_SETTINGS: Settings = {
  appearance: { theme: 'dark', locale: 'pt-BR', sidebarCollapsed: false, detailsCollapsed: false },
  voice: { language: 'auto', modelId: 'large-v3-turbo-q5_0' },
  sessions: {
    autoArchiveDays: 0,
    collapseFinishedTurns: true,
    rateLimitFailover: 'off',
    maxConsecutiveToolErrors: 5,
    maxConsecutiveVerificationFailures: 3,
    maxSessionCostUsd: 0,
    maxContextPercent: 90,
  },
  notifications: {
    waitingInput: true,
    failed: true,
    completed: false,
    onlyWhenUnfocused: true,
  },
  models: {
    claude: { model: null, effort: 'medium' },
    codex: { model: null, effort: 'medium' },
    gemini: { model: null, effort: 'medium' },
    deepseek: { model: null, effort: 'medium' },
    kimi: { model: null, effort: 'medium' },
    grok: { model: null, effort: 'medium' },
    qwen: { model: null, effort: 'medium' },
    opencode: { model: null, effort: 'medium' },
  },
};

type FieldGuard = (value: unknown) => boolean;

const isBoolean: FieldGuard = (value) => typeof value === 'boolean';

const MAX_MODEL_ID_LENGTH = 200;

function providerModelDefaults(provider: ProviderId, allowStoredEffort: boolean): FieldGuard {
  return (value) =>
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    (value['model'] === null ||
      (typeof value['model'] === 'string' &&
        value['model'].length > 0 &&
        value['model'].length <= MAX_MODEL_ID_LENGTH)) &&
    isEffortLevel(value['effort']) &&
    (allowStoredEffort ||
      PROVIDER_MODELS[provider].efforts.length === 0 ||
      isEffortSupported(provider, value['effort']));
}

function oneOf(options: readonly unknown[]): FieldGuard {
  return (value) => options.includes(value);
}

const isPolishModel: FieldGuard = (value) =>
  typeof value === 'string' && value.length <= MAX_POLISH_MODEL_LENGTH;

const isPolishEndpoint: FieldGuard = (value) => isPolishEndpointUrl(value);

const isCustomDictionary: FieldGuard = (value) =>
  Array.isArray(value) &&
  value.length <= MAX_DICTIONARY_ITEMS &&
  value.every(
    (item) =>
      typeof item === 'string' && item.trim() !== '' && item.length <= MAX_DICTIONARY_ITEM_LENGTH,
  );

const buildSectionGuards = (
  allowStoredEffort: boolean,
): { [Section in keyof Settings]: Record<keyof Settings[Section], FieldGuard> } => ({
  appearance: {
    theme: oneOf(['system', 'dark', 'light']),
    locale: oneOf(LOCALE_PREFERENCES),
    sidebarCollapsed: isBoolean,
    detailsCollapsed: isBoolean,
  },
  voice: {
    language: oneOf(['auto', 'pt', 'en', 'es']),
    modelId: oneOf(VOICE_MODEL_IDS),
    polishMode: oneOf(VOICE_POLISH_MODES),
    polishModel: isPolishModel,
    polishEndpoint: isPolishEndpoint,
    customDictionary: isCustomDictionary,
  },
  sessions: {
    autoArchiveDays: oneOf([0, 1, 3, 7, 30]),
    collapseFinishedTurns: isBoolean,
    rateLimitFailover: oneOf(RATE_LIMIT_FAILOVER_POLICIES),
    maxConsecutiveToolErrors: oneOf([0, 3, 5, 10]),
    maxConsecutiveVerificationFailures: oneOf([0, 2, 3, 5]),
    maxSessionCostUsd: oneOf([0, 1, 5, 10, 25]),
    maxContextPercent: oneOf([0, 80, 90, 95]),
  },
  notifications: {
    waitingInput: isBoolean,
    failed: isBoolean,
    completed: isBoolean,
    onlyWhenUnfocused: isBoolean,
  },
  models: {
    claude: providerModelDefaults('claude', allowStoredEffort),
    codex: providerModelDefaults('codex', allowStoredEffort),
    gemini: providerModelDefaults('gemini', allowStoredEffort),
    deepseek: providerModelDefaults('deepseek', allowStoredEffort),
    kimi: providerModelDefaults('kimi', allowStoredEffort),
    grok: providerModelDefaults('grok', allowStoredEffort),
    qwen: providerModelDefaults('qwen', allowStoredEffort),
    opencode: providerModelDefaults('opencode', allowStoredEffort),
  },
});

const STORED_SECTION_GUARDS = buildSectionGuards(true);
const PATCH_SECTION_GUARDS = buildSectionGuards(false);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidSection(input: {
  value: unknown;
  guards: Record<string, FieldGuard>;
  allowUnknownKeys: boolean;
}): boolean {
  const { value, guards, allowUnknownKeys } = input;
  if (!isRecord(value)) return false;
  return Object.keys(value).every((key) => {
    const guard = Object.hasOwn(guards, key) ? guards[key] : undefined;
    return guard === undefined ? allowUnknownKeys : guard(value[key]);
  });
}

function isValidSettingsShape(input: { value: unknown; allowUnknownKeys: boolean }): boolean {
  const { value, allowUnknownKeys } = input;
  if (!isRecord(value)) return false;
  const sectionGuards = allowUnknownKeys ? STORED_SECTION_GUARDS : PATCH_SECTION_GUARDS;
  return Object.keys(value).every((section) => {
    const guards = Object.hasOwn(sectionGuards, section)
      ? sectionGuards[section as keyof Settings]
      : undefined;
    return guards === undefined
      ? allowUnknownKeys
      : isValidSection({ value: value[section], guards, allowUnknownKeys });
  });
}

// NOTE: absent fields are valid in a stored store so a field added in a later version does not
// make an older store.json corrupt; getSettings fills them from DEFAULT_SETTINGS.
export function isSettings(value: unknown): boolean {
  return isValidSettingsShape({ value, allowUnknownKeys: true });
}

export function isSettingsPatch(value: unknown): value is SettingsPatch {
  return isValidSettingsShape({ value, allowUnknownKeys: false });
}

function mergeSettings(input: {
  stored: SettingsPatch | undefined;
  patch?: SettingsPatch;
}): Settings {
  const { stored, patch } = input;
  return {
    appearance: { ...DEFAULT_SETTINGS.appearance, ...stored?.appearance, ...patch?.appearance },
    voice: { ...DEFAULT_SETTINGS.voice, ...stored?.voice, ...patch?.voice },
    sessions: { ...DEFAULT_SETTINGS.sessions, ...stored?.sessions, ...patch?.sessions },
    notifications: {
      ...DEFAULT_SETTINGS.notifications,
      ...stored?.notifications,
      ...patch?.notifications,
    },
    models: { ...DEFAULT_SETTINGS.models, ...stored?.models, ...patch?.models },
  };
}

export async function getSettings(root: string): Promise<Settings> {
  const store = await loadStore(root);
  return mergeSettings({ stored: store.settings });
}

export async function updateSettings(ctx: {
  root: string;
  patch: SettingsPatch;
}): Promise<Settings> {
  if (!isSettingsPatch(ctx.patch)) throw new SettingsError('Invalid settings patch');
  return withStoreLock(ctx.root, async () => {
    const store = await loadStore(ctx.root);
    const settings = mergeSettings({ stored: store.settings, patch: ctx.patch });
    store.settings = settings;
    await saveStore(ctx.root, store);
    return settings;
  });
}
