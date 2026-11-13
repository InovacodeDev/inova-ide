import { mkdir, mkdtemp, readFile, readdir, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  VOICE_MODEL,
  VoiceError,
  buildVoicePrompt,
  cleanTranscript,
  createVoiceHandlers,
  createVoiceService,
  encodeWav,
  parseTranscribe,
  whisperArgs,
  type VoiceDeps,
} from '../src/main/voice.js';

const ONE_SECOND = new Uint8Array(16_000 * 2);

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'inova-voice-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup(overrides: Partial<VoiceDeps> = {}) {
  const binary = join(dir, 'whisper-cli');
  await writeFile(binary, '');
  const runWhisper = vi.fn<VoiceDeps['runWhisper']>(async () => ' olá mundo \n');
  const onProgress = vi.fn();
  const service = createVoiceService({
    modelDir: join(dir, 'models'),
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
  async function seedModel(): Promise<void> {
    await mkdir(join(dir, 'models'), { recursive: true });
    const path = join(dir, 'models', VOICE_MODEL.file);
    await writeFile(path, '');
    await truncate(path, VOICE_MODEL.bytes);
  }

  test('status reports the first existing binary and a model of the exact size', async () => {
    const { service } = await setup();
    expect(await service.status()).toEqual({
      binary: true,
      model: false,
      modelBytes: VOICE_MODEL.bytes,
    });
    await seedModel();
    expect((await service.status()).model).toBe(true);
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
});
