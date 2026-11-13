import { describe, expect, test } from 'vitest';
import { PROVIDER_MODELS } from '@inova/core/models';
import {
  formatPickerLabel,
  normalizeCustomModelInput,
  resolveModelOptions,
} from '../src/renderer/model-picker-state';

describe('model-picker-state', () => {
  test('formats trigger label for default, known, and custom models with effort', () => {
    const claude = PROVIDER_MODELS.claude;
    expect(formatPickerLabel({ model: null, effort: null, catalog: claude })).toBe(
      'Padrão (Padrão)',
    );
    expect(formatPickerLabel({ model: 'opus', effort: 'high', catalog: claude })).toBe(
      'Opus 5.5 (Alto)',
    );
    expect(formatPickerLabel({ model: 'fable', effort: 'max', catalog: claude })).toBe(
      'Fable 5.2 (Máximo)',
    );
    expect(
      formatPickerLabel({ model: 'gpt-6-sol', effort: 'medium', catalog: PROVIDER_MODELS.codex }),
    ).toBe('GPT 6 Sol (Médio)');
    expect(formatPickerLabel({ model: 'claude-opus-4-6', effort: 'xhigh', catalog: claude })).toBe(
      'claude-opus-4-6 (Extra alto)',
    );
  });

  test('resolves model list with default option and appends active custom model', () => {
    const gemini = PROVIDER_MODELS.gemini;
    const withKnown = resolveModelOptions({ model: 'gemini-4-hydrogen-high', catalog: gemini });
    expect(withKnown[0]).toEqual({
      id: '',
      label: 'Auto',
      description: 'Usar padrão do provedor',
    });
    expect(withKnown.some((item) => item.description === 'Modelo customizado')).toBe(false);

    const withCustom = resolveModelOptions({ model: 'custom-model-v1', catalog: gemini });
    expect(withCustom.at(-1)).toEqual({
      id: 'custom-model-v1',
      label: 'custom-model-v1',
      description: 'Modelo customizado',
    });
  });

  test('normalizes custom model input and rejects empty or oversized values', () => {
    expect(normalizeCustomModelInput('   ')).toBeNull();
    expect(normalizeCustomModelInput('  sonnet-4.5  ')).toBe('sonnet-4.5');
    expect(normalizeCustomModelInput('a'.repeat(201))).toBeNull();
  });
});
