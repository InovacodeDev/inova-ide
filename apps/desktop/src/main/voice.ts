import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Result, VoiceModelProgress, VoiceStatus } from '../shared/api.js';
import { fail, isRecord, ok } from './validation.js';

export const VOICE_SAMPLE_RATE = 16_000;
export const VOICE_MAX_SECONDS = 120;
export const VOICE_MODEL = {
  file: 'ggml-small-q5_1.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
  bytes: 190_085_487,
  sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
} as const;

const MIN_AUDIO_BYTES = VOICE_SAMPLE_RATE * 2 * 0.3;
const MAX_AUDIO_BYTES = VOICE_SAMPLE_RATE * 2 * VOICE_MAX_SECONDS;
const MAX_HINTS = 8;
const MAX_HINT_CHARS = 120;
const PROGRESS_STEP_BYTES = VOICE_MODEL.bytes / 100;
const GLOSSARY =
  'TypeScript, JavaScript, React, Node, API, JSON, middleware, helper, token, commit, branch, merge, pull request, deploy, endpoint, regex, localhost';
const INSTALL_HINT = 'Instale o whisper.cpp (macOS: brew install whisper-cpp).';

export class VoiceError extends Error {}

export interface TranscribeInput {
  pcm: Uint8Array;
  final: boolean;
  language: string;
  hints: string[];
}

export interface VoiceDeps {
  modelDir: string;
  binaryCandidates: readonly string[];
  findOnPath: () => Promise<string | undefined>;
  runWhisper: (input: { file: string; args: string[]; signal: AbortSignal }) => Promise<string>;
  fetch: (url: string) => Promise<Response>;
  onProgress: (progress: VoiceModelProgress) => void;
}

export interface VoiceService {
  status(): Promise<VoiceStatus>;
  downloadModel(): Promise<void>;
  transcribe(input: TranscribeInput): Promise<string>;
}

export function encodeWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}

export function buildVoicePrompt(hints: readonly string[]): string {
  return [...hints, GLOSSARY].join(', ');
}

export function whisperArgs(input: {
  modelPath: string;
  wavPath: string;
  language: string;
  prompt: string;
}): string[] {
  return [
    '--model',
    input.modelPath,
    '--file',
    input.wavPath,
    '--language',
    input.language,
    '--prompt',
    input.prompt,
    '--no-timestamps',
    '--no-prints',
    '--suppress-nst',
  ];
}

export function cleanTranscript(stdout: string): string {
  // REGEX: drop whisper non-speech annotations such as [BLANK_AUDIO], [Música] or (risos)
  const annotations = /\[[^\]\n]*\]|\([^)\n]*\)/g;
  return stdout.replace(annotations, ' ').replace(/\s+/g, ' ').trim();
}

async function isFile(path: string, bytes?: number): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && (bytes === undefined || info.size === bytes);
  } catch (error: unknown) {
    if (isRecord(error) && error['code'] === 'ENOENT') return false;
    throw error;
  }
}

export function createVoiceService(deps: VoiceDeps): VoiceService {
  const modelPath = join(deps.modelDir, VOICE_MODEL.file);
  let download: Promise<void> | null = null;
  let active: AbortController | null = null;

  async function findBinary(): Promise<string | undefined> {
    for (const candidate of deps.binaryCandidates) {
      if (await isFile(candidate)) return candidate;
    }
    return deps.findOnPath();
  }

  async function fetchModel(): Promise<void> {
    const response = await deps.fetch(VOICE_MODEL.url);
    if (!response.ok || response.body === null) {
      throw new VoiceError(`Falha ao baixar o modelo de voz (HTTP ${response.status}).`);
    }
    await mkdir(deps.modelDir, { recursive: true });
    const partPath = `${modelPath}.part`;
    const hash = createHash('sha256');
    const handle = await open(partPath, 'w');
    let receivedBytes = 0;
    let reportedBytes = 0;
    try {
      for await (const chunk of response.body) {
        hash.update(chunk);
        await handle.write(chunk);
        receivedBytes += chunk.byteLength;
        if (receivedBytes - reportedBytes >= PROGRESS_STEP_BYTES) {
          reportedBytes = receivedBytes;
          deps.onProgress({ receivedBytes, totalBytes: VOICE_MODEL.bytes });
        }
      }
      await handle.close();
      if (receivedBytes !== VOICE_MODEL.bytes || hash.digest('hex') !== VOICE_MODEL.sha256) {
        throw new VoiceError('O modelo de voz baixado está corrompido. Tente de novo.');
      }
      await rename(partPath, modelPath);
      deps.onProgress({ receivedBytes, totalBytes: VOICE_MODEL.bytes });
    } catch (error: unknown) {
      await handle.close();
      await rm(partPath, { force: true });
      throw error;
    }
  }

  return {
    async status() {
      return {
        binary: (await findBinary()) !== undefined,
        model: await isFile(modelPath, VOICE_MODEL.bytes),
        modelBytes: VOICE_MODEL.bytes,
      };
    },

    downloadModel() {
      download ??= isFile(modelPath, VOICE_MODEL.bytes)
        .then((present) => (present ? undefined : fetchModel()))
        .finally(() => {
          download = null;
        });
      return download;
    },

    async transcribe(input) {
      if (input.pcm.byteLength < MIN_AUDIO_BYTES) return '';
      if (active !== null) {
        if (!input.final) throw new VoiceError('Transcrição em andamento.');
        active.abort();
      }
      const controller = new AbortController();
      active = controller;
      const workDir = await mkdtemp(join(tmpdir(), 'inova-voice-'));
      try {
        const file = await findBinary();
        if (file === undefined) throw new VoiceError(`whisper-cli não encontrado. ${INSTALL_HINT}`);
        if (!(await isFile(modelPath, VOICE_MODEL.bytes))) {
          throw new VoiceError('Modelo de voz não encontrado. Baixe o modelo antes de ditar.');
        }
        const wavPath = join(workDir, 'audio.wav');
        await writeFile(wavPath, encodeWav(input.pcm, VOICE_SAMPLE_RATE));
        const args = whisperArgs({
          modelPath,
          wavPath,
          language: input.language,
          prompt: buildVoicePrompt(input.hints),
        });
        return cleanTranscript(await deps.runWhisper({ file, args, signal: controller.signal }));
      } finally {
        if (active === controller) active = null;
        await rm(workDir, { recursive: true, force: true });
      }
    },
  };
}

export function parseTranscribe(input: unknown): TranscribeInput | undefined {
  if (!isRecord(input)) return undefined;
  const { pcm, final, language, hints } = input;
  if (!(pcm instanceof Uint8Array) || pcm.byteLength > MAX_AUDIO_BYTES) return undefined;
  if (pcm.byteLength % 2 !== 0 || typeof final !== 'boolean') return undefined;
  // REGEX: two-letter ISO 639-1 code accepted by whisper, or automatic detection
  if (typeof language !== 'string' || !/^(?:[a-z]{2}|auto)$/.test(language)) return undefined;
  if (!Array.isArray(hints) || hints.length > MAX_HINTS) return undefined;
  const safeHints = hints.filter(
    (hint): hint is string =>
      typeof hint === 'string' && hint.trim() !== '' && hint.length <= MAX_HINT_CHARS,
  );
  if (safeHints.length !== hints.length) return undefined;
  return { pcm, final, language, hints: safeHints.map((hint) => hint.replace(/\s+/g, ' ')) };
}

async function voiceGuarded<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await work());
  } catch (error: unknown) {
    if (error instanceof VoiceError) return fail(error.message);
    if (error instanceof Error && error.name === 'AbortError') {
      return fail('Transcrição cancelada.');
    }
    throw error;
  }
}

export function createVoiceHandlers(service: VoiceService) {
  return {
    getVoiceStatus: (): Promise<Result<VoiceStatus>> => voiceGuarded(() => service.status()),
    downloadVoiceModel: (): Promise<Result<null>> =>
      voiceGuarded(() => service.downloadModel().then(() => null)),
    transcribeAudio: (input: unknown): Promise<Result<{ text: string }>> => {
      const parsed = parseTranscribe(input);
      if (parsed === undefined) return Promise.resolve(fail('Áudio inválido.'));
      return voiceGuarded(async () => ({ text: await service.transcribe(parsed) }));
    },
  };
}

export type VoiceHandlers = ReturnType<typeof createVoiceHandlers>;
