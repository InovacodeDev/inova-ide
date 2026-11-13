import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  getSettings,
  isSettings,
  isSettingsPatch,
  SettingsError,
  updateSettings,
  VOICE_MODEL_IDS,
} from './settings.js';
import { loadStore, saveStore } from './store.js';
import type { SettingsPatch } from './types.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inova-settings-'));
});

describe('settings', () => {
  it('getSettings returns the defaults when the store has no settings', async () => {
    expect(await getSettings(root)).toEqual(DEFAULT_SETTINGS);
    await saveStore(root, { version: 1, accounts: [], projects: [] });
    expect(await getSettings(root)).toEqual(DEFAULT_SETTINGS);
  });

  it('getSettings fills fields missing from the stored settings with defaults', async () => {
    await writeFile(
      join(root, 'store.json'),
      JSON.stringify({
        version: 1,
        accounts: [],
        projects: [],
        settings: { notifications: { completed: true } },
      }),
    );
    expect(await getSettings(root)).toEqual({
      ...DEFAULT_SETTINGS,
      notifications: { ...DEFAULT_SETTINGS.notifications, completed: true },
    });
  });

  it('updateSettings merges a partial patch per section and persists it', async () => {
    await updateSettings({ root, patch: { sessions: { autoArchiveDays: 7 } } });
    const result = await updateSettings({
      root,
      patch: { notifications: { completed: true }, voice: { language: 'pt' } },
    });
    const expected = {
      voice: { ...DEFAULT_SETTINGS.voice, language: 'pt' },
      sessions: { autoArchiveDays: 7, collapseFinishedTurns: true },
      notifications: { ...DEFAULT_SETTINGS.notifications, completed: true },
    };
    expect(result).toEqual(expected);
    expect(await getSettings(root)).toEqual(expected);
    expect((await loadStore(root)).settings).toEqual(expected);
  });

  it('updateSettings keeps the rest of the store', async () => {
    await saveStore(root, {
      version: 1,
      accounts: [],
      projects: [],
      defaultModes: { claude: 'plan' },
    });
    await updateSettings({ root, patch: { voice: { language: 'en' } } });
    expect((await loadStore(root)).defaultModes).toEqual({ claude: 'plan' });
  });

  it('updateSettings does not lose concurrent patches', async () => {
    await Promise.all([
      updateSettings({ root, patch: { voice: { language: 'es' } } }),
      updateSettings({ root, patch: { sessions: { collapseFinishedTurns: false } } }),
      updateSettings({ root, patch: { notifications: { failed: false } } }),
    ]);
    expect(await getSettings(root)).toEqual({
      voice: { ...DEFAULT_SETTINGS.voice, language: 'es' },
      sessions: { autoArchiveDays: 0, collapseFinishedTurns: false },
      notifications: { ...DEFAULT_SETTINGS.notifications, failed: false },
    });
  });

  it('updateSettings stores the voice model next to the language', async () => {
    expect(DEFAULT_SETTINGS.voice.modelId).toBe('large-v3-turbo-q5_0');
    for (const modelId of VOICE_MODEL_IDS) {
      const result = await updateSettings({ root, patch: { voice: { modelId } } });
      expect(result.voice).toEqual({ language: 'auto', modelId });
    }
    await updateSettings({ root, patch: { voice: { language: 'en' } } });
    expect((await getSettings(root)).voice).toEqual({
      language: 'en',
      modelId: VOICE_MODEL_IDS[VOICE_MODEL_IDS.length - 1],
    });
  });

  it('getSettings fills a missing voice model for a store saved before the field existed', async () => {
    await writeFile(
      join(root, 'store.json'),
      JSON.stringify({
        version: 1,
        accounts: [],
        projects: [],
        settings: { voice: { language: 'pt' } },
      }),
    );
    expect((await getSettings(root)).voice).toEqual({
      language: 'pt',
      modelId: DEFAULT_SETTINGS.voice.modelId,
    });
  });

  it.each<[string, unknown]>([
    ['a voice model outside the catalog', { voice: { modelId: 'huge' } }],
    ['a path as voice model', { voice: { modelId: '../ggml-base' } }],
    ['an unknown section', { appearance: { theme: 'dark' } }],
    ['an unknown field', { voice: { volume: 1 } }],
    ['a value outside the enum', { sessions: { autoArchiveDays: 5 } }],
    ['a wrong type', { notifications: { failed: 'yes' } }],
    ['an explicit undefined', { voice: { language: undefined } }],
    ['a non-object section', { voice: 'pt' }],
  ])('updateSettings rejects %s and leaves the store untouched', async (_name, patch) => {
    await expect(updateSettings({ root, patch: patch as SettingsPatch })).rejects.toBeInstanceOf(
      SettingsError,
    );
    expect((await loadStore(root)).settings).toBeUndefined();
  });

  it('isSettingsPatch rejects non-objects and prototype keys', () => {
    expect(isSettingsPatch(null)).toBe(false);
    expect(isSettingsPatch([])).toBe(false);
    expect(isSettingsPatch(JSON.parse('{"__proto__":{"language":"pt"}}'))).toBe(false);
    expect(isSettingsPatch({})).toBe(true);
  });

  it('isSettings ignores unknown keys and absent fields', () => {
    expect(isSettings(DEFAULT_SETTINGS)).toBe(true);
    expect(isSettings({ voice: { language: 'pt', future: 'x' }, later: {} })).toBe(true);
    expect(isSettings({ voice: {} })).toBe(true);
    expect(isSettings({ voice: { language: 'fr' } })).toBe(false);
    expect(isSettings({ voice: { modelId: 'future' } })).toBe(false);
    expect(isSettings('settings')).toBe(false);
  });
});
