import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createChatParser } from './chat-events.js';
import { extractTurnUsageFromLine } from './cost-tracking.js';
import {
  PROVIDER_MODELS,
  effortsForModel,
  isEffortSupported,
  parseAgyModelsOutput,
  parseClaudeModelCatalog,
  parseCodexModelsCache,
  resolveModelConfig,
  splitModelEffortVariant,
} from './models.js';
import { discoverAccountModelsFromDisk } from './providers.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { nativeSlashCommands } from './slash-commands.js';

const tempDirs: string[] = [];

async function makeTempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'inova-model-discovery-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

  it('parses Claude model-catalog JSON with aliases, overflow models, and per-model efforts', () => {
    const raw = JSON.stringify({
      version: 2,
      fetchedAt: 1795097822180,
      catalog: {
        config: {
          provider_alias_targets: {
            sonnet: { default: 'claude-sonnet-5-5' },
            opus: { default: 'claude-opus-5-5' },
            fable: { default: 'claude-fable-5-2' },
            haiku: { default: 'claude-haiku-5-5' },
          },
          models: [
            {
              id: 'claude-opus-5-5',
              name: 'Opus 5.5',
              short_name: 'Opus',
              section: 'main',
              runtime: { effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
            },
            {
              id: 'claude-sonnet-5-5',
              name: 'Sonnet 5.5',
              short_name: 'Sonnet',
              section: 'main',
              runtime: { effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
            },
            {
              id: 'claude-fable-5-2',
              name: 'Fable 5.2',
              short_name: 'Fable',
              section: 'main',
              runtime: { effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
            },
            {
              id: 'claude-haiku-5-5',
              name: 'Haiku 5.5',
              short_name: 'Haiku',
              section: 'main',
              thinking: {
                type: 'effort',
                effort_options: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
              },
            },
            {
              id: 'claude-sonnet-4-6',
              name: 'Sonnet 4.6',
              short_name: 'Sonnet',
              section: 'overflow',
              runtime: { effort_levels: ['low', 'medium', 'high', 'max'] },
            },
            {
              id: 'claude-haiku-4-5-20251001',
              name: 'Haiku 4.5',
              short_name: 'Haiku',
              section: 'overflow',
              thinking: { type: 'none' },
            },
          ],
        },
      },
    });

    const parsed = parseClaudeModelCatalog(raw);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('Expected parsed Claude catalog');

    expect(parsed.models.slice(0, 5).map((m) => m.id)).toEqual([
      'sonnet',
      'opus',
      'fable',
      'haiku',
      'opusplan',
    ]);
    expect(effortsForModel(parsed, 'haiku')).toEqual(['low', 'medium', 'high']);
    expect(effortsForModel(parsed, 'claude-sonnet-4-6')).toEqual(['low', 'medium', 'high', 'max']);
    expect(effortsForModel(parsed, 'claude-haiku-4-5-20251001')).toEqual([]);
  });

  it('parses Codex models_cache.json, hides internal models, and maps supported reasoning levels', () => {
    const raw = JSON.stringify({
      models: [
        {
          slug: 'gpt-reserve',
          display_name: 'GPT-Reserve',
          visibility: 'hide',
          priority: 1,
          supported_reasoning_levels: [{ effort: 'medium' }],
        },
        {
          slug: 'gpt-6.3-nova',
          display_name: 'GPT-6.3-Nova',
          description: 'New frontier release',
          visibility: 'list',
          priority: 1,
          supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
        },
        {
          slug: 'gpt-5.6-terra',
          display_name: 'GPT-5.6-Terra',
          visibility: 'list',
          priority: 2,
          supported_reasoning_levels: [
            { effort: 'low' },
            { effort: 'medium' },
            { effort: 'ultra' },
          ],
        },
      ],
    });

    const parsed = parseCodexModelsCache(raw);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('Expected parsed Codex catalog');

    expect(parsed.models[0]).toEqual({
      id: 'gpt-6.3-nova',
      label: 'GPT 6.3 Nova',
      description: 'New frontier release',
      efforts: ['low', 'high'],
    });
    expect(parsed.models.some((m) => m.id === 'gpt-reserve')).toBe(false);
    expect(effortsForModel(parsed, 'gpt-5.6-terra')).toEqual(['low', 'medium']);
    expect(parsed.models.some((m) => m.id === 'gpt-6.2-astra')).toBe(true);
  });

  it('discovers account models from disk and changes fingerprint when cache files update', async () => {
    const claudeHome = await makeTempHome();
    const claudeDir = join(claudeHome, 'cache', 'model-catalog');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, 'failed.headless-failed.json'), '{"error":true}');
    await writeFile(
      join(claudeDir, 'older.json'),
      JSON.stringify({
        fetchedAt: 100,
        catalog: {
          config: {
            models: [
              { id: 'claude-sonnet-5', name: 'Sonnet 5', short_name: 'Sonnet', section: 'main' },
            ],
          },
        },
      }),
    );
    await writeFile(
      join(claudeDir, 'newer.json'),
      JSON.stringify({
        fetchedAt: 200,
        catalog: {
          config: {
            models: [
              { id: 'claude-sonnet-6', name: 'Sonnet 6', short_name: 'Sonnet', section: 'main' },
            ],
          },
        },
      }),
    );

    const claudeDiscovered = await discoverAccountModelsFromDisk({
      provider: 'claude',
      homeDir: claudeHome,
    });
    expect(claudeDiscovered).not.toBeNull();
    expect(claudeDiscovered?.catalog.models.find((m) => m.id === 'sonnet')?.label).toBe('Sonnet 6');
    expect(claudeDiscovered?.fingerprint).toContain('newer.json');

    const codexHome = await makeTempHome();
    await writeFile(
      join(codexHome, 'models_cache.json'),
      JSON.stringify({
        models: [
          {
            slug: 'gpt-7-test',
            display_name: 'GPT-7-Test',
            visibility: 'list',
            supported_reasoning_levels: [{ effort: 'low' }],
          },
        ],
      }),
    );
    const codexFirst = await discoverAccountModelsFromDisk({
      provider: 'codex',
      homeDir: codexHome,
    });
    expect(codexFirst?.catalog.models[0]?.id).toBe('gpt-7-test');

    const qwenHome = await makeTempHome();
    await mkdir(join(qwenHome, '.qwen'), { recursive: true });
    await writeFile(
      join(qwenHome, '.qwen', 'settings.json'),
      JSON.stringify({ model: 'qwen5-pro' }),
    );
    const qwenDiscovered = await discoverAccountModelsFromDisk({
      provider: 'qwen',
      homeDir: qwenHome,
    });
    expect(qwenDiscovered?.catalog.models[0]?.id).toBe('qwen5-pro');

    const grokHome = await makeTempHome();
    await writeFile(
      join(grokHome, 'config.toml'),
      'model = "grok-5"\n[mcp_servers.a]\nenabled = true\n',
    );
    const grokDiscovered = await discoverAccountModelsFromDisk({
      provider: 'grok',
      homeDir: grokHome,
    });
    expect(grokDiscovered?.catalog.models[0]?.id).toBe('grok-5');
  });
});
