import type { Settings } from '@inova/core/types';
import { describe, expect, test } from 'vitest';
import { applySettingsPatch, inverseSettingsPatch } from '../src/renderer/settings-state';

const settings: Settings = {
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
  appearance: { theme: 'dark', sidebarCollapsed: false },
  voice: { language: 'auto', modelId: 'small-q5_1' },
  sessions: { autoArchiveDays: 0, collapseFinishedTurns: true },
  notifications: {
    waitingInput: true,
    failed: true,
    completed: false,
    onlyWhenUnfocused: true,
  },
};

describe('applySettingsPatch', () => {
  test('merges per section and keeps untouched fields', () => {
    const next = applySettingsPatch(settings, {
      notifications: { completed: true },
      voice: { language: 'pt' },
    });
    expect(next.notifications).toEqual({ ...settings.notifications, completed: true });
    expect(next.voice).toEqual({ language: 'pt', modelId: 'small-q5_1' });
    expect(next.appearance).toEqual(settings.appearance);
    expect(next.sessions).toEqual(settings.sessions);
  });

  test('does not mutate the input', () => {
    applySettingsPatch(settings, { appearance: { theme: 'light' } });
    expect(settings.appearance.theme).toBe('dark');
  });
});

describe('inverseSettingsPatch', () => {
  test('restores only the patched keys, so a later change survives a rollback', () => {
    const patch = { sessions: { autoArchiveDays: 7 as const } };
    const optimistic = applySettingsPatch(settings, patch);
    const laterChange = applySettingsPatch(optimistic, {
      sessions: { collapseFinishedTurns: false },
    });
    const rolledBack = applySettingsPatch(laterChange, inverseSettingsPatch(settings, patch));
    expect(rolledBack.sessions).toEqual({ autoArchiveDays: 0, collapseFinishedTurns: false });
  });

  test('ignores sections that the patch does not touch', () => {
    const inverse = inverseSettingsPatch(settings, { voice: { modelId: 'base' } });
    expect(inverse.voice).toEqual({ modelId: 'small-q5_1' });
    expect(inverse.appearance).toBeUndefined();
    expect(inverse.notifications).toBeUndefined();
  });
});
