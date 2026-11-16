import { describe, expect, test, vi } from 'vitest';
import {
  buildEloquentSystemPrompt,
  isValidPolishedOutput,
  listOllamaModels,
  pickBestPolishModel,
  polishTranscript,
  probeOllamaEndpoint,
} from '../src/main/voice-polish.js';

describe('pickBestPolishModel', () => {
  test('prefers explicit model when configured', () => {
    expect(pickBestPolishModel(['llama3.2:3b', 'gemma3:4b'], 'custom-model')).toBe('custom-model');
  });

  test('prefers gemma variants over other local models when auto-selecting', () => {
    expect(pickBestPolishModel(['mistral:7b', 'qwen2.5:3b', 'gemma3:4b'], '')).toBe('gemma3:4b');
    expect(pickBestPolishModel(['mistral:7b', 'qwen2.5:3b'], '')).toBe('qwen2.5:3b');
    expect(pickBestPolishModel(['mistral:7b'], '')).toBe('mistral:7b');
    expect(pickBestPolishModel([], '')).toBeUndefined();
  });
});

describe('buildEloquentSystemPrompt & isValidPolishedOutput', () => {
  test('includes structured instructions and project vocabulary', () => {
    const prompt = buildEloquentSystemPrompt({
      mode: 'structured',
      language: 'pt',
      hints: ['InovaIDE', 'voice.ts'],
    });
    expect(prompt).toContain('bullet points');
    expect(prompt).toContain('InovaIDE, voice.ts');
    expect(prompt).toContain('"pt"');
  });

  test('rejects empty, over-expanded or preamble outputs', () => {
    expect(isValidPolishedOutput('cria um teste', '')).toBe(false);
    expect(
      isValidPolishedOutput('cria um teste para o arquivo voice.ts agora', 'x'.repeat(200)),
    ).toBe(false);
    expect(isValidPolishedOutput('cria um teste', 'Claro, aqui está: cria um teste')).toBe(false);
    expect(isValidPolishedOutput('cria um teste', 'Crie um teste.')).toBe(true);
  });
});

describe('listOllamaModels & polishTranscript', () => {
  test('lists installed models from /api/tags and handles offline endpoints', async () => {
    const okFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ models: [{ name: 'gemma3:4b' }, { name: 'qwen2.5:3b' }] })),
    );
    expect(await listOllamaModels({ endpoint: 'http://127.0.0.1:11434/', fetch: okFetch })).toEqual(
      ['gemma3:4b', 'qwen2.5:3b'],
    );
    expect(okFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    const failFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(
      await listOllamaModels({ endpoint: 'http://127.0.0.1:11434', fetch: failFetch }),
    ).toEqual([]);
    expect(
      await probeOllamaEndpoint({ endpoint: 'http://127.0.0.1:11434', fetch: failFetch }),
    ).toEqual({
      reachable: false,
      models: [],
      error: 'ECONNREFUSED',
    });
    expect(
      await probeOllamaEndpoint({
        endpoint: 'http://127.0.0.1:11434',
        fetch: async () => new Response(JSON.stringify({ models: [] })),
      }),
    ).toEqual({
      reachable: true,
      models: [],
    });
  });

  test('polishes speech self-corrections using Ollama and falls back cleanly on errors', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'gemma3:4b' }] }));
      }
      return new Response(
        JSON.stringify({
          message: { content: 'Crie um endpoint PATCH para atualizar o usuário.' },
        }),
      );
    });

    const result = await polishTranscript({
      text: 'cria um endpoint GET não espera PATCH para atualizar o usuário',
      mode: 'clean',
      model: '',
      endpoint: 'http://127.0.0.1:11434',
      language: 'pt',
      hints: ['PATCH'],
      fetch,
    });
    expect(result).toEqual({
      text: 'Crie um endpoint PATCH para atualizar o usuário.',
      polished: true,
    });

    const offResult = await polishTranscript({
      text: 'texto original',
      mode: 'off',
      model: '',
      endpoint: 'http://127.0.0.1:11434',
      language: 'pt',
      hints: [],
      fetch,
    });
    expect(offResult).toEqual({ text: 'texto original', polished: false });

    const offlineResult = await polishTranscript({
      text: 'texto original',
      mode: 'clean',
      model: 'gemma3:4b',
      endpoint: 'http://127.0.0.1:11434',
      language: 'pt',
      hints: [],
      fetch: async () => new Response(null, { status: 500 }),
    });
    expect(offlineResult).toEqual({ text: 'texto original', polished: false });
  });
});
