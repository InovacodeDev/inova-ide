import { describe, expect, it } from 'vitest';
import {
  PROVIDER_MODELS,
  isEffortLevel,
  isEffortSupported,
  parseAgyModelsOutput,
  parseOpenCodeModelsOutput,
  resolveModelConfig,
} from './models.js';
import { DEFAULT_SETTINGS } from './settings.js';

describe('models', () => {
  it('validates effort levels and provider support', () => {
    expect(isEffortLevel('high')).toBe(true);
    expect(isEffortLevel('xhigh')).toBe(true);
    expect(isEffortLevel('ultra')).toBe(false);
    expect(isEffortLevel(null)).toBe(false);

    expect(isEffortSupported('claude', 'max')).toBe(true);
    expect(isEffortSupported('claude', 'minimal')).toBe(false);
    expect(isEffortSupported('codex', 'minimal')).toBe(true);
    expect(isEffortSupported('codex', 'max')).toBe(false);
    expect(isEffortSupported('gemini', 'high')).toBe(true);
    expect(isEffortSupported('gemini', 'minimal')).toBe(false);
  });

  it('resolves the effective model and effort from the session and the settings defaults', () => {
    const models = {
      ...DEFAULT_SETTINGS.models,
      claude: { model: 'opus', effort: 'high' as const },
    };
    const settings = { models };
    expect(resolveModelConfig({ provider: 'claude', model: null, effort: null, settings })).toEqual(
      {
        model: 'opus',
        effort: 'high',
      },
    );
    expect(
      resolveModelConfig({ provider: 'claude', model: 'haiku', effort: 'low', settings }),
    ).toEqual({ model: 'haiku', effort: 'low' });
    expect(resolveModelConfig({ provider: 'codex', model: null, effort: null, settings })).toEqual({
      model: null,
      effort: 'medium',
    });
  });

  it('falls back to the settings effort, then to null, for an unsupported effort', () => {
    const settings = { models: DEFAULT_SETTINGS.models };
    expect(
      resolveModelConfig({ provider: 'claude', model: null, effort: 'minimal', settings }),
    ).toEqual({ model: null, effort: 'medium' });
    const unsupportedDefault = {
      models: { ...DEFAULT_SETTINGS.models, claude: { model: null, effort: 'minimal' as const } },
    };
    expect(
      resolveModelConfig({
        provider: 'claude',
        model: null,
        effort: 'minimal',
        settings: unsupportedDefault,
      }),
    ).toEqual({ model: null, effort: null });
  });

  it('parses agy models output with spinner noise and deduplicates ids', () => {
    const raw = [
      '\r\u001b[K⠋ Fetching available models...\r⠙ Fetching available models...',
      'gemini-4-hydrogen-high          Gemini 4 Hydrogen (High)',
      'gemini-4-hydrogen-low           Gemini 4 Hydrogen (Low)',
      'gemini-4-hydrogen-high          Gemini 4 Hydrogen (High)',
      'claude-opus-5-5-medium          Claude Opus 5.5 (Medium)',
      '',
    ].join('\n');

    expect(parseAgyModelsOutput(raw)).toEqual([
      { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High)' },
      { id: 'gemini-4-hydrogen-low', label: 'Gemini 4 Hydrogen (Low)' },
      { id: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5 (Medium)' },
    ]);
  });

  it('parses opencode models output and deduplicates ids', () => {
    const raw = ['anthropic/claude-sonnet-4-5', 'openai/gpt-5', 'anthropic/claude-sonnet-4-5'].join(
      '\n',
    );
    expect(parseOpenCodeModelsOutput(raw)).toEqual([
      { id: 'anthropic/claude-sonnet-4-5', label: 'claude-sonnet-4-5', description: 'anthropic' },
      { id: 'openai/gpt-5', label: 'gpt-5', description: 'openai' },
    ]);
  });

  it('exposes non-empty fallback catalogs for all providers', () => {
    for (const provider of [
      'claude',
      'codex',
      'gemini',
      'deepseek',
      'kimi',
      'grok',
      'qwen',
      'opencode',
    ] as const) {
      expect(PROVIDER_MODELS[provider].models.length).toBeGreaterThan(0);
      expect(PROVIDER_MODELS[provider].efforts.length).toBeGreaterThan(0);
      for (const model of PROVIDER_MODELS[provider].models) {
        expect(model.label).toMatch(/\d/);
      }
    }
  });
});
