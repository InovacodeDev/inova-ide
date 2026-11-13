import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { VOICE_MODEL_IDS } from '@inova/core/settings';
import type { VoiceModelId } from '@inova/core/types';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  VOICE_MODELS,
  VoiceError,
  buildVoicePrompt,
  cleanTranscript,
  createVoiceHandlers,
  createVoiceService,
  encodeWav,
  parseTranscribe,
  parseVoiceDownload,
  parseVoiceModelRequest,
  whisperArgs,
  type VoiceDeps,
} from '../src/main/voice.js';

const ONE_SECOND = new Uint8Array(16_000 * 2);
const DEFAULT_MODEL: VoiceModelId = 'large-v3-turbo-q5_0';
const ORIGINAL_MODELS = { ...VOICE_MODELS };

let dir = '';
let activeModel: VoiceModelId = DEFAULT_MODEL;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'inova-voice-test-'));
  activeModel = DEFAULT_MODEL;
});

afterEach(async () => {
  Object.assign(VOICE_MODELS, ORIGINAL_MODELS);
  await rm(dir, { recursive: true, force: true });
});

function shrinkModel(modelId: VoiceModelId, payload: string): void {
  VOICE_MODELS[modelId] = {
    ...ORIGINAL_MODELS[modelId],
    bytes: Buffer.byteLength(payload),
    sha256: createHash('sha256').update(payload).digest('hex'),
  };
}

async function setup(overrides: Partial<VoiceDeps> = {}) {
  const binary = join(dir, 'whisper-cli');
  await writeFile(binary, '');
  const runWhisper = vi.fn<VoiceDeps['runWhisper']>(async () => ' olá mundo \n');
  const onProgress = vi.fn();
  const service = createVoiceService({
    modelDir: join(dir, 'models'),
    getModelId: async () => activeModel,
    binaryCandidates: [join(dir, 'missing'), binary],
    findOnPath: async () => undefined,
    runWhisper,
    fetch: async () => new Response(null, { status: 500 }),
    onProgress,
    ...overrides,
  });
  return { service, runWhisper, onProgress, binary };
}

describe('pure helpers', () => {
  test('encodeWav writes a 16-bit mono PCM header', () => {
    const wav = encodeWav(new Uint8Array([1, 2, 3, 4]), 16_000);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(40);
    expect(wav.subarray(8, 16).toString('ascii')).toBe('WAVEfmt ');
    expect([wav.readUInt16LE(20), wav.readUInt16LE(22), wav.readUInt16LE(34)]).toEqual([1, 1, 16]);
    expect([wav.readUInt32LE(24), wav.readUInt32LE(28)]).toEqual([16_000, 32_000]);
    expect(wav.readUInt32LE(40)).toBe(4);
    expect([...wav.subarray(44)]).toEqual([1, 2, 3, 4]);
  });

  test('cleanTranscript drops annotations and collapses whitespace', () => {
    expect(cleanTranscript(' [BLANK_AUDIO]\n rode os testes\n (risos) agora. \n')).toBe(
      'rode os testes agora.',
    );
    expect(cleanTranscript('[Música]')).toBe('');
  });

  test('the prompt puts the session hints before the glossary', () => {
    expect(buildVoicePrompt(['inova-ide', 'feat/voz'])).toMatch(
      /^inova-ide, feat\/voz, TypeScript/,
    );
  });

  test('whisperArgs passes every value as its own argument', () => {
    const args = whisperArgs({
      modelPath: '/m.bin',
      wavPath: '/a.wav',
      language: 'pt',
      prompt: 'a, b',
    });
    expect(args).toEqual([
      '--model',
      '/m.bin',
      '--file',
      '/a.wav',
      '--language',
      'pt',
      '--prompt',
      'a, b',
      '--no-timestamps',
      '--no-prints',
      '--suppress-nst',
    ]);
  });
});

describe('parseTranscribe', () => {
  const valid = { pcm: new Uint8Array(4), final: true, language: 'pt', hints: ['inova  ide'] };

  test('accepts a valid request and normalizes hint whitespace', () => {
    expect(parseTranscribe(valid)).toEqual({ ...valid, hints: ['inova ide'] });
    expect(parseTranscribe({ ...valid, language: 'auto' })?.language).toBe('auto');
  });

  test('rejects malformed audio, language and hints', () => {
    const bad = [
      null,
      { ...valid, pcm: [1, 2] },
      { ...valid, pcm: new Uint8Array(3) },
      { ...valid, pcm: new Uint8Array(16_000 * 2 * 120 + 2) },
      { ...valid, final: 'yes' },
      { ...valid, language: '--help' },
      { ...valid, language: 'PT' },
      { ...valid, hints: 'x' },
      { ...valid, hints: [''] },
      { ...valid, hints: ['a'.repeat(121)] },
      { ...valid, hints: new Array(9).fill('a') },
    ];
    for (const input of bad) expect(parseTranscribe(input)).toBeUndefined();
  });
});

describe('voice service', () => {
  async function seedModel(modelId: VoiceModelId = DEFAULT_MODEL): Promise<void> {
    await mkdir(join(dir, 'models'), { recursive: true });
    const path = join(dir, 'models', VOICE_MODELS[modelId].file);
    await writeFile(path, '');
    await truncate(path, VOICE_MODELS[modelId].bytes);
  }

  test('the catalog covers every model id with a real Hugging Face file', () => {
    expect(Object.keys(VOICE_MODELS).sort()).toEqual([...VOICE_MODEL_IDS].sort());
    for (const spec of Object.values(ORIGINAL_MODELS)) {
      expect(spec.url).toBe(
        `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${spec.file}`,
      );
      expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(spec.bytes).toBeGreaterThan(100_000_000);
    }
  });

  test('status reports the first existing binary and a model of the exact size', async () => {
    const { service } = await setup();
    const status = await service.status();
    expect(status).toMatchObject({
      binary: true,
      model: false,
      modelBytes: VOICE_MODELS[DEFAULT_MODEL].bytes,
      modelId: DEFAULT_MODEL,
      installed: [],
    });
    expect(status.catalog).toEqual(
      VOICE_MODEL_IDS.map((id) => ({
        id,
        label: VOICE_MODELS[id].label,
        bytes: VOICE_MODELS[id].bytes,
      })),
    );
    await seedModel();
    expect((await service.status()).model).toBe(true);
  });

  test('status follows the active model without restarting the service', async () => {
    await seedModel(DEFAULT_MODEL);
    const { service } = await setup();
    activeModel = 'base';
    expect(await service.status()).toMatchObject({
      model: false,
      modelId: 'base',
      modelBytes: VOICE_MODELS.base.bytes,
      installed: [DEFAULT_MODEL],
    });
    await seedModel('base');
    expect(await service.status()).toMatchObject({
      model: true,
      installed: ['base', DEFAULT_MODEL],
    });
  });

  test('transcribe runs whisper with the file of the active model', async () => {
    await seedModel('base');
    const { service, runWhisper } = await setup();
    const input = { pcm: ONE_SECOND, final: true, language: 'pt', hints: [] };
    await expect(service.transcribe(input)).rejects.toThrow(/Modelo de voz não encontrado/);
    activeModel = 'base';
    await service.transcribe(input);
    expect(runWhisper.mock.calls[0]?.[0].args[1]).toBe(join(dir, 'models', 'ggml-base.bin'));
  });

  test('downloadModel fetches a model that is not the active one and reports its id', async () => {
    shrinkModel('base', 'tiny base model');
    const fetch = vi.fn(async () => new Response('tiny base model'));
    const { service, onProgress } = await setup({ fetch });
    await service.downloadModel({ modelId: 'base' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(ORIGINAL_MODELS.base.url);
    expect(onProgress).toHaveBeenLastCalledWith({
      modelId: 'base',
      receivedBytes: 15,
      totalBytes: 15,
    });
    expect(await readdir(join(dir, 'models'))).toEqual(['ggml-base.bin']);
    expect(await service.status()).toMatchObject({ model: false, installed: ['base'] });
  });

  test('downloads of different models run independently and the same model is shared', async () => {
    shrinkModel('base', 'tiny base model');
    shrinkModel('small-q5_1', 'tiny small model');
    const fetch = vi.fn(
      async (url: string) =>
        new Response(url === ORIGINAL_MODELS.base.url ? 'tiny base model' : 'tiny small model'),
    );
    const { service } = await setup({ fetch });
    await Promise.all([
      service.downloadModel({ modelId: 'base' }),
      service.downloadModel({ modelId: 'small-q5_1' }),
      service.downloadModel({ modelId: 'base' }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await service.status()).installed).toEqual(['base', 'small-q5_1']);
  });

  test('downloadModel without input downloads the active model', async () => {
    shrinkModel('base', 'tiny base model');
    activeModel = 'base';
    const fetch = vi.fn(async () => new Response('tiny base model'));
    const { service } = await setup({ fetch });
    await service.downloadModel();
    expect(fetch).toHaveBeenCalledWith(ORIGINAL_MODELS.base.url);
    expect((await service.status()).model).toBe(true);
  });

  test('deleteModel removes only the catalog file of that model and returns the status', async () => {
    await seedModel('base');
    await seedModel(DEFAULT_MODEL);
    await writeFile(join(dir, 'models', 'keep.bin'), 'x');
    const { service } = await setup();
    const status = await service.deleteModel({ modelId: 'base' });
    expect(status.installed).toEqual([DEFAULT_MODEL]);
    expect(status.model).toBe(true);
    expect((await readdir(join(dir, 'models'))).sort()).toEqual([
      'ggml-large-v3-turbo-q5_0.bin',
      'keep.bin',
    ]);
    expect((await service.deleteModel({ modelId: DEFAULT_MODEL })).model).toBe(false);
    expect((await service.deleteModel({ modelId: 'base' })).installed).toEqual([]);
  });

  test('deleteModel refuses a model that is still downloading', async () => {
    shrinkModel('base', 'tiny base model');
    let release: () => void = () => undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        release = () => {
          controller.enqueue(new TextEncoder().encode('tiny base model'));
          controller.close();
        };
      },
    });
    const fetch = vi.fn(async () => new Response(body));
    const { service } = await setup({ fetch });
    const pending = service.downloadModel({ modelId: 'base' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await expect(service.deleteModel({ modelId: 'base' })).rejects.toThrow(/sendo baixado/);
    release();
    await pending;
    expect((await service.status()).installed).toEqual(['base']);
  });

  test('status falls back to the PATH lookup', async () => {
    const { service } = await setup({ binaryCandidates: [], findOnPath: async () => '/bin/w' });
    expect((await service.status()).binary).toBe(true);
    const none = await setup({ binaryCandidates: [] });
    expect((await none.service.status()).binary).toBe(false);
  });

  test('transcribe writes a wav, runs whisper and removes the temp folder', async () => {
    await seedModel();
    let wavPath = '';
    let wavBytes = 0;
    const { service, binary } = await setup({
      runWhisper: async ({ file, args }) => {
        expect(file).toBe(binary);
        wavPath = args[3] ?? '';
        wavBytes = (await readFile(wavPath)).byteLength;
        return ' [BLANK_AUDIO] olá mundo \n';
      },
    });
    const text = await service.transcribe({
      pcm: ONE_SECOND,
      final: true,
      language: 'pt',
      hints: ['inova-ide'],
    });
    expect(text).toBe('olá mundo');
    expect(wavBytes).toBe(44 + ONE_SECOND.byteLength);
    await expect(stat(dirname(wavPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('transcribe returns empty text for audio shorter than 0.3 s without running whisper', async () => {
    await seedModel();
    const { service, runWhisper } = await setup();
    const input = { pcm: new Uint8Array(100), final: true, language: 'pt', hints: [] };
    expect(await service.transcribe(input)).toBe('');
    expect(runWhisper).not.toHaveBeenCalled();
  });

  test('transcribe fails with a clear message without binary or model', async () => {
    const input = { pcm: ONE_SECOND, final: true, language: 'pt', hints: [] };
    const noModel = await setup();
    await expect(noModel.service.transcribe(input)).rejects.toThrow(/Modelo de voz não encontrado/);
    await seedModel();
    const noBinary = await setup({ binaryCandidates: [] });
    await expect(noBinary.service.transcribe(input)).rejects.toThrow(/whisper-cli não encontrado/);
  });

  test('a final request aborts the interim one and an interim request is refused while busy', async () => {
    await seedModel();
    const signals: AbortSignal[] = [];
    const { service } = await setup({
      runWhisper: ({ signal }) => {
        signals.push(signal);
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new VoiceError('aborted')));
          if (signals.length === 2) resolve('final');
        });
      },
    });
    const base = { pcm: ONE_SECOND, language: 'pt', hints: [] };
    const interim = service.transcribe({ ...base, final: false });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    await expect(service.transcribe({ ...base, final: false })).rejects.toThrow(/em andamento/);
    const final = service.transcribe({ ...base, final: true });
    await expect(interim).rejects.toThrow('aborted');
    expect(await final).toBe('final');
    expect(signals[0]?.aborted).toBe(true);
  });

  test('downloadModel rejects a corrupted file and leaves nothing behind', async () => {
    const { service } = await setup({ fetch: async () => new Response('not the model') });
    await expect(service.downloadModel()).rejects.toThrow(/corrompido/);
    expect(await readdir(join(dir, 'models'))).toEqual([]);
    expect((await service.status()).model).toBe(false);
  });

  test('downloadModel reports an HTTP failure', async () => {
    const { service } = await setup();
    await expect(service.downloadModel()).rejects.toThrow(/HTTP 500/);
  });

  test('downloadModel skips the network when the model is present', async () => {
    await seedModel();
    const fetch = vi.fn(async () => new Response(null, { status: 500 }));
    const { service } = await setup({ fetch });
    await service.downloadModel();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('voice handlers', () => {
  test('map voice errors to failed results and reject invalid audio', async () => {
    const { service } = await setup();
    const handlers = createVoiceHandlers(service);
    expect(await handlers.transcribeAudio({ pcm: 'x' })).toEqual({
      ok: false,
      message: 'Áudio inválido.',
    });
    const result = await handlers.transcribeAudio({
      pcm: ONE_SECOND,
      final: true,
      language: 'pt',
      hints: [],
    });
    expect(result).toMatchObject({ ok: false });
    expect(await handlers.getVoiceStatus()).toMatchObject({ ok: true, value: { binary: true } });
    expect(await handlers.downloadVoiceModel()).toMatchObject({ ok: false });
  });

  test('deleteVoiceModel removes a catalog model and returns the status', async () => {
    await mkdir(join(dir, 'models'), { recursive: true });
    const path = join(dir, 'models', VOICE_MODELS.base.file);
    await writeFile(path, '');
    await truncate(path, VOICE_MODELS.base.bytes);
    const { service } = await setup();
    const result = await createVoiceHandlers(service).deleteVoiceModel({ modelId: 'base' });
    expect(result).toMatchObject({ ok: true, value: { installed: [] } });
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('deleteVoiceModel and downloadVoiceModel reject ids outside the catalog', async () => {
    await mkdir(join(dir, 'models'), { recursive: true });
    await writeFile(join(dir, 'models', 'victim.bin'), 'x');
    const fetch = vi.fn(async () => new Response(null, { status: 500 }));
    const { service } = await setup({ fetch });
    const handlers = createVoiceHandlers(service);
    const invalid = [
      undefined,
      null,
      'base',
      {},
      { modelId: 'victim' },
      { modelId: '../victim' },
      { modelId: 'ggml-base.bin' },
      { modelId: '__proto__' },
      { modelId: 1 },
    ];
    for (const input of invalid) {
      expect(await handlers.deleteVoiceModel(input)).toEqual({
        ok: false,
        message: 'Modelo de voz inválido.',
      });
    }
    for (const input of invalid.filter((value) => value !== undefined)) {
      expect(await handlers.downloadVoiceModel(input)).toEqual({
        ok: false,
        message: 'Modelo de voz inválido.',
      });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(await readdir(join(dir, 'models'))).toEqual(['victim.bin']);
  });

  test('downloadVoiceModel downloads the requested model', async () => {
    shrinkModel('small-q5_1', 'tiny small model');
    const fetch = vi.fn(async () => new Response('tiny small model'));
    const { service } = await setup({ fetch });
    const result = await createVoiceHandlers(service).downloadVoiceModel({
      modelId: 'small-q5_1',
    });
    expect(result).toEqual({ ok: true, value: null });
    expect(fetch).toHaveBeenCalledWith(ORIGINAL_MODELS['small-q5_1'].url);
  });

  test('request parsers accept only catalog ids', () => {
    expect(parseVoiceModelRequest({ modelId: 'medium-q5_0', extra: 1 })).toEqual({
      modelId: 'medium-q5_0',
    });
    expect(parseVoiceModelRequest({ modelId: 'huge' })).toBeUndefined();
    expect(parseVoiceDownload(undefined)).toEqual({});
    expect(parseVoiceDownload({ modelId: 'base' })).toEqual({ modelId: 'base' });
    expect(parseVoiceDownload({})).toBeUndefined();
    expect(parseVoiceDownload(null)).toBeUndefined();
  });
});
