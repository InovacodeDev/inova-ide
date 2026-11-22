import { describe, expect, test } from 'vitest';
import { PROVIDER_MODELS } from '@inova/core/models';
import {
  formatPickerLabel,
  localizeModelOption,
  normalizeCustomModelInput,
  resolveModelOptions,
} from '../src/renderer/model-picker-state';

describe('model-picker-state', () => {
  test('formats trigger label for default, known, and custom models with effort', () => {
    const claude = PROVIDER_MODELS.claude;
    expect(formatPickerLabel({ model: null, effort: null, catalog: claude })).toBe('Padrão');
    expect(formatPickerLabel({ model: null, effort: 'medium', catalog: claude })).toBe(
      'Padrão (Médio)',
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
      description: 'Usar padrão do provider',
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

  test('localizes updated model descriptions in en-US and formats flagship labels', () => {
    expect(
      formatPickerLabel({
        model: 'gpt-6.2-astra',
        effort: 'xhigh',
        catalog: PROVIDER_MODELS.codex,
      }),
    ).toBe('GPT 6.2 Astra (Extra alto)');
    expect(
      formatPickerLabel({
        model: 'gemini-4-neon-high',
        effort: 'medium',
        catalog: PROVIDER_MODELS.gemini,
      }),
    ).toBe('Gemini 4 Neon (Médio)');
    expect(
      formatPickerLabel({
        model: 'gemini-4-neon-high',
        effort: null,
        catalog: PROVIDER_MODELS.gemini,
      }),
    ).toBe('Gemini 4 Neon (Alto)');
    expect(
      formatPickerLabel({
        model: 'gemini-pro-orchestrator-neon',
        effort: 'medium',
        catalog: PROVIDER_MODELS.gemini,
      }),
    ).toBe('Orchestrator (Neon)');
    expect(
      formatPickerLabel({
        model: 'deepseek-flash',
        effort: 'medium',
        catalog: PROVIDER_MODELS.deepseek,
      }),
    ).toBe('DeepSeek V4.1 Flash');

    const cases: [keyof typeof PROVIDER_MODELS, string][] = [
      ['codex', 'gpt-6.2-astra'],
      ['deepseek', 'deepseek-flash'],
      ['kimi', 'kimi-k3.1-pro'],
      ['grok', 'grok-4.7'],
      ['qwen', 'qwen4-max'],
      ['opencode', 'opencode/deepseek-v4.1-flash-free'],
    ];
    for (const [provider, id] of cases) {
      const option = PROVIDER_MODELS[provider].models.find((item) => item.id === id);
      if (!option) throw new Error(`Missing model ${id}`);
      const localized = localizeModelOption(option, 'en-US');
      expect(localized.description).toBeTruthy();
      expect(localized.description).not.toBe(option.description);
    }
  });
});
