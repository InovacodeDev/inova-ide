import { loadStore, saveStore, withStoreLock } from './store.js';
import type { Settings, SettingsPatch, VoiceModelId } from './types.js';

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

export const VOICE_MODEL_IDS: readonly VoiceModelId[] = [
  'base',
  'small-q5_1',
  'medium-q5_0',
  'large-v3-turbo-q5_0',
];

export const DEFAULT_SETTINGS: Settings = {
  voice: { language: 'auto', modelId: 'large-v3-turbo-q5_0' },
  sessions: { autoArchiveDays: 0, collapseFinishedTurns: true },
  notifications: {
    waitingInput: true,
    failed: true,
    completed: false,
    onlyWhenUnfocused: true,
  },
};

type FieldGuard = (value: unknown) => boolean;

const isBoolean: FieldGuard = (value) => typeof value === 'boolean';

function oneOf(options: readonly unknown[]): FieldGuard {
  return (value) => options.includes(value);
}

const SECTION_GUARDS: { [Section in keyof Settings]: Record<keyof Settings[Section], FieldGuard> } =
  {
    voice: { language: oneOf(['auto', 'pt', 'en', 'es']), modelId: oneOf(VOICE_MODEL_IDS) },
    sessions: {
      autoArchiveDays: oneOf([0, 1, 3, 7, 30]),
      collapseFinishedTurns: isBoolean,
    },
    notifications: {
      waitingInput: isBoolean,
      failed: isBoolean,
      completed: isBoolean,
      onlyWhenUnfocused: isBoolean,
    },
  };

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
  return Object.keys(value).every((section) => {
    const guards = Object.hasOwn(SECTION_GUARDS, section)
      ? SECTION_GUARDS[section as keyof Settings]
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
    voice: { ...DEFAULT_SETTINGS.voice, ...stored?.voice, ...patch?.voice },
    sessions: { ...DEFAULT_SETTINGS.sessions, ...stored?.sessions, ...patch?.sessions },
    notifications: {
      ...DEFAULT_SETTINGS.notifications,
      ...stored?.notifications,
      ...patch?.notifications,
    },
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
