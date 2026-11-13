import { describe, expect, test } from 'vitest';
import { downloadPercent, voiceModelState } from '../src/renderer/voice-model-state';

describe('voiceModelState', () => {
  const base = { activeId: 'small-q5_1', installed: ['base', 'small-q5_1'] } as const;

  test('reports in-use, installed and missing from the installed list', () => {
    expect(voiceModelState({ ...base, modelId: 'small-q5_1', downloading: false })).toBe('in-use');
    expect(voiceModelState({ ...base, modelId: 'base', downloading: false })).toBe('installed');
    expect(voiceModelState({ ...base, modelId: 'medium-q5_0', downloading: false })).toBe(
      'missing',
    );
  });

  test('an active download wins over every other state', () => {
    expect(voiceModelState({ ...base, modelId: 'medium-q5_0', downloading: true })).toBe(
      'downloading',
    );
    expect(voiceModelState({ ...base, modelId: 'small-q5_1', downloading: true })).toBe(
      'downloading',
    );
  });

  test('a selected model that is not installed is missing, not in use', () => {
    expect(
      voiceModelState({
        modelId: 'medium-q5_0',
        activeId: 'medium-q5_0',
        installed: ['base'],
        downloading: false,
      }),
    ).toBe('missing');
  });
});

describe('downloadPercent', () => {
  test('floors the ratio and clamps it between 0 and 100', () => {
    expect(downloadPercent({ receivedBytes: 1, totalBytes: 3 })).toBe(33);
    expect(downloadPercent({ receivedBytes: 3, totalBytes: 3 })).toBe(100);
    expect(downloadPercent({ receivedBytes: 9, totalBytes: 3 })).toBe(100);
    expect(downloadPercent({ receivedBytes: -1, totalBytes: 3 })).toBe(0);
  });

  test('returns 0 when the total size is unknown', () => {
    expect(downloadPercent({ receivedBytes: 10, totalBytes: 0 })).toBe(0);
    expect(downloadPercent({ receivedBytes: 10, totalBytes: -5 })).toBe(0);
  });
});
