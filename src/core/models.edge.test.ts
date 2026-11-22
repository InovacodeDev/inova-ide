import { describe, expect, it } from 'vitest';
import { createChatParser } from './chat-events.js';
import { extractTurnUsageFromLine } from './cost-tracking.js';
import {
  PROVIDER_MODELS,
  effortsForModel,
  isEffortSupported,
  parseAgyModelsOutput,
  resolveModelConfig,
  splitModelEffortVariant,
} from './models.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { nativeSlashCommands } from './slash-commands.js';

describe('gemini 1.5.14 update and conditional effort support edge cases', () => {
  it('groups real agy 1.5.14 output into base models with per-model efforts', () => {
    const raw = [
      'Fetching available models...',
      'gemini-4-neon-xhigh\tGemini 4 Neon (XHigh)',
      'gemini-4-neon-high\tGemini 4 Neon (High)',
      'gemini-4-neon-medium\tGemini 4 Neon (Medium)',
      'gemini-4-neon-low\tGemini 4 Neon (Low)',
      'gemini-4-argon-high\tGemini 4 Argon (High)',
      'gemini-4-argon-medium\tGemini 4 Argon (Medium)',
      'gemini-4-argon-low\tGemini 4 Argon (Low)',
      'gemini-pro-orchestrator-neon\tOrchestrator (Neon)',
      'gemini-pro-orchestrator-g1-pro\tOrchestrator (Argon)',
      'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
      '',
    ].join('\n');

    const catalog = {
      defaultModelLabel: 'Auto',
      models: parseAgyModelsOutput(raw),
      efforts: PROVIDER_MODELS.gemini.efforts,
    };

    expect(catalog.models).toEqual([
      { id: 'gemini-4-neon', label: 'Gemini 4 Neon', efforts: ['low', 'medium', 'high', 'xhigh'] },
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon', efforts: ['low', 'medium', 'high'] },
      { id: 'gemini-pro-orchestrator-neon', label: 'Orchestrator (Neon)' },
      { id: 'gemini-pro-orchestrator-g1-pro', label: 'Orchestrator (Argon)' },
      { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
    ]);

    expect(effortsForModel(catalog, 'gemini-4-neon')).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(effortsForModel(catalog, 'gemini-4-argon')).toEqual(['low', 'medium', 'high']);
    expect(effortsForModel(catalog, 'gemini-pro-orchestrator-neon')).toEqual([]);
    expect(effortsForModel(catalog, 'gemini-pro-orchestrator-g1-pro')).toEqual([]);
    expect(effortsForModel(catalog, 'gpt-oss-120b-medium')).toEqual([]);
  });

  it('hides effort for fixed Gemini models and providers that do not support effort', () => {
    const gemini = PROVIDER_MODELS.gemini;
    expect(effortsForModel(gemini, 'gemini-pro-orchestrator-neon')).toEqual([]);
    expect(effortsForModel(gemini, 'gemini-pro-orchestrator-g1-pro')).toEqual([]);
    expect(effortsForModel(gemini, 'gpt-oss-120b-medium')).toEqual([]);
    expect(effortsForModel(gemini, 'gemini-4-argon')).toEqual(['low', 'medium', 'high']);
    expect(isEffortSupported('gemini', 'max', 'gemini-4-neon')).toBe(false);
    expect(isEffortSupported('gemini', 'xhigh', 'gemini-4-argon')).toBe(false);
    expect(isEffortSupported('gemini', 'medium', 'gemini-pro-orchestrator-neon')).toBe(false);

    for (const provider of ['deepseek', 'kimi', 'grok', 'qwen', 'opencode'] as const) {
      expect(effortsForModel(PROVIDER_MODELS[provider], null)).toEqual([]);
      expect(
        resolveModelConfig({
          provider,
          model: PROVIDER_MODELS[provider].models[0]?.id ?? null,
          effort: 'high',
          settings: DEFAULT_SETTINGS,
        }),
      ).toEqual({
        model: PROVIDER_MODELS[provider].models[0]?.id ?? null,
        effort: null,
      });
    }
  });

  it('normalizes legacy Gemini variant IDs and clears unsupported efforts on resolveModelConfig', () => {
    expect(splitModelEffortVariant(PROVIDER_MODELS.gemini, 'gemini-4-hydrogen-high')).toEqual({
      model: 'gemini-4-hydrogen',
      effort: 'high',
    });

    expect(
      resolveModelConfig({
        provider: 'gemini',
        model: 'gemini-4-hydrogen-high',
        effort: null,
        settings: DEFAULT_SETTINGS,
      }),
    ).toEqual({
      model: 'gemini-4-hydrogen',
      effort: 'high',
    });

    expect(
      resolveModelConfig({
        provider: 'gemini',
        model: 'gemini-4-hydrogen-high',
        effort: 'xhigh',
        settings: DEFAULT_SETTINGS,
      }),
    ).toEqual({
      model: 'gemini-4-hydrogen',
      effort: 'xhigh',
    });

    expect(
      resolveModelConfig({
        provider: 'gemini',
        model: 'gemini-pro-orchestrator-neon',
        effort: 'high',
        settings: DEFAULT_SETTINGS,
      }),
    ).toEqual({
      model: 'gemini-pro-orchestrator-neon',
      effort: null,
    });
  });

  it('emits thinking-delta from agy 1.5.14 step_update, reads cache_read_tokens, and exposes /effort', () => {
    const parser = createChatParser('gemini', { turnId: 't1' });
    const events = parser.parse(
      JSON.stringify({
        event: 'step_update',
        step_update: {
          step_index: 1,
          step_type: 'agent_response',
          state: 'RUNNING',
          thinking_delta: 'Analisando...',
        },
      }),
    );
    expect(events).toEqual([
      { kind: 'thinking-delta', blockId: 't1:gemini-thinking-1', text: 'Analisando...' },
    ]);

    expect(
      extractTurnUsageFromLine(
        JSON.stringify({
          event: 'result',
          result: {
            stats: {
              input_tokens: 1200,
              cache_read_tokens: 800,
              output_tokens: 150,
            },
          },
        }),
      ),
    ).toEqual({
      inputTokens: 400,
      outputTokens: 150,
      cacheReadTokens: 800,
      cacheWriteTokens: 0,
    });

    expect(nativeSlashCommands('gemini').some((cmd) => cmd.name === 'effort')).toBe(true);
  });
});
