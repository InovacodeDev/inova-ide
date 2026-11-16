import { describe, expect, test, vi } from 'vitest';
import type { VoiceDockerProgress } from '../src/shared/api.js';
import {
  VoiceDockerError,
  createVoiceDockerSetup,
  hasInstalledModel,
  isValidOllamaModelName,
} from '../src/main/voice-docker.js';

describe('voice-docker helpers', () => {
  test('validates Ollama model names and detects installed tags', () => {
    expect(isValidOllamaModelName('gemma3:4b')).toBe(true);
    expect(isValidOllamaModelName('hf.co/user/model:q4')).toBe(true);
    expect(isValidOllamaModelName('--bad')).toBe(false);
    expect(isValidOllamaModelName('bad model')).toBe(false);
    expect(isValidOllamaModelName('')).toBe(false);

    expect(hasInstalledModel(['gemma3:latest'], 'gemma3')).toBe(true);
    expect(hasInstalledModel(['gemma3:4b'], 'gemma3:4b')).toBe(true);
    expect(hasInstalledModel(['qwen2.5:3b'], 'gemma3:4b')).toBe(false);
  });
});

describe('createVoiceDockerSetup', () => {
  test('fails with clear errors when Docker binary or daemon is unavailable', async () => {
    const noBinary = createVoiceDockerSetup({
      findDocker: async () => undefined,
      runDocker: vi.fn(),
      probeEndpoint: vi.fn(),
      fetch: vi.fn(),
      onProgress: vi.fn(),
    });
    await expect(noBinary()).rejects.toThrow(VoiceDockerError);

    const noDaemon = createVoiceDockerSetup({
      findDocker: async () => '/usr/local/bin/docker',
      runDocker: async () => {
        throw new Error('Cannot connect to the Docker daemon');
      },
      probeEndpoint: vi.fn(),
      fetch: vi.fn(),
      onProgress: vi.fn(),
    });
    await expect(noDaemon()).rejects.toThrow(/daemon está parado/);
  });

  test('creates container, waits for Ollama, pulls model with streaming progress and returns models', async () => {
    const progress: VoiceDockerProgress[] = [];
    const runDocker = vi.fn(async ({ args }: { file: string; args: string[] }) => {
      if (args[0] === 'inspect') throw new Error('No such container');
      return '27.0.0\n';
    });
    let probeCount = 0;
    const probeEndpoint = vi.fn(async () => {
      probeCount += 1;
      if (probeCount === 1) return { reachable: false, models: [] };
      if (probeCount === 2) return { reachable: true, models: [] };
      return { reachable: true, models: ['gemma3:4b'] };
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(
          enc.encode(`${JSON.stringify({ status: 'downloading', completed: 50, total: 100 })}\n`),
        );
        controller.enqueue(
          enc.encode(`${JSON.stringify({ status: 'success', completed: 100, total: 100 })}\n`),
        );
        controller.close();
      },
    });
    const fetch = vi.fn(async () => new Response(stream));

    const setup = createVoiceDockerSetup({
      findDocker: async () => '/usr/local/bin/docker',
      runDocker,
      probeEndpoint,
      fetch,
      onProgress: (item) => progress.push(item),
      readyPollMs: 1,
    });

    const result = await setup({ model: 'gemma3:4b' });
    expect(result).toMatchObject({
      endpoint: 'http://127.0.0.1:11434',
      reachable: true,
      models: ['gemma3:4b'],
    });
    expect(runDocker).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['run', '-d', '--name', 'inova-eloquent-ollama']),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/pull',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(progress.some((item) => item.stage === 'pulling' && item.percent === 50)).toBe(true);
    expect(progress[progress.length - 1]).toEqual({
      stage: 'ready',
      model: 'gemma3:4b',
      percent: 100,
    });
  });

  test('starts existing stopped container and skips pull when model is already installed', async () => {
    const runDocker = vi.fn(async ({ args }: { file: string; args: string[] }) => {
      if (args[0] === 'inspect') return 'false\n';
      return '';
    });
    const fetch = vi.fn();
    const setup = createVoiceDockerSetup({
      findDocker: async () => '/usr/local/bin/docker',
      runDocker,
      probeEndpoint: async () => ({ reachable: true, models: ['gemma3:4b'] }),
      fetch,
      onProgress: vi.fn(),
    });

    const result = await setup();
    expect(result.models).toEqual(['gemma3:4b']);
    expect(runDocker).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['start', 'inova-eloquent-ollama'] }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
