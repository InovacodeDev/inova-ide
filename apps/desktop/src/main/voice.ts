import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VOICE_MODEL_IDS } from '@inova/core/settings';
import type { VoiceModelId } from '@inova/core/types';
import type { Result, VoiceModelProgress, VoiceStatus } from '../shared/api.js';
import { fail, isRecord, ok } from './validation.js';

export const VOICE_SAMPLE_RATE = 16_000;
export const VOICE_MAX_SECONDS = 120;
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export interface VoiceModelSpec {
  file: string;
  url: string;
  bytes: number;
  sha256: string;
  label: string;
}

export const VOICE_MODELS: Record<VoiceModelId, VoiceModelSpec> = {
  base: {
    file: 'ggml-base.bin',
    url: `${MODEL_BASE_URL}/ggml-base.bin`,
    bytes: 147_951_465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    label: 'Base',
  },
  'small-q5_1': {
    file: 'ggml-small-q5_1.bin',
    url: `${MODEL_BASE_URL}/ggml-small-q5_1.bin`,
    bytes: 190_085_487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
    label: 'Small (q5_1)',
  },
  'medium-q5_0': {
    file: 'ggml-medium-q5_0.bin',
    url: `${MODEL_BASE_URL}/ggml-medium-q5_0.bin`,
    bytes: 539_212_467,
    sha256: '19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f',
    label: 'Medium (q5_0)',
  },
  'large-v3-turbo-q5_0': {
    file: 'ggml-large-v3-turbo-q5_0.bin',
    url: `${MODEL_BASE_URL}/ggml-large-v3-turbo-q5_0.bin`,
    bytes: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    label: 'Large v3 Turbo (q5_0)',
  },
};

const MIN_AUDIO_BYTES = VOICE_SAMPLE_RATE * 2 * 0.3;
const MAX_AUDIO_BYTES = VOICE_SAMPLE_RATE * 2 * VOICE_MAX_SECONDS;
const MAX_HINTS = 8;
const MAX_HINT_CHARS = 120;
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
  getModelId: () => Promise<VoiceModelId>;
  binaryCandidates: readonly string[];
  findOnPath: () => Promise<string | undefined>;
  runWhisper: (input: { file: string; args: string[]; signal: AbortSignal }) => Promise<string>;
  fetch: (url: string) => Promise<Response>;
  onProgress: (progress: VoiceModelProgress) => void;
}

export interface VoiceService {
  status(): Promise<VoiceStatus>;
  downloadModel(input?: { modelId?: VoiceModelId }): Promise<void>;
  deleteModel(input: { modelId: VoiceModelId }): Promise<VoiceStatus>;
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
  const downloads = new Map<VoiceModelId, Promise<void>>();
  let active: AbortController | null = null;

  function modelPath(modelId: VoiceModelId): string {
    return join(deps.modelDir, VOICE_MODELS[modelId].file);
  }

  function hasModel(modelId: VoiceModelId): Promise<boolean> {
    return isFile(modelPath(modelId), VOICE_MODELS[modelId].bytes);
  }

  async function findBinary(): Promise<string | undefined> {
    for (const candidate of deps.binaryCandidates) {
      if (await isFile(candidate)) return candidate;
    }
    return deps.findOnPath();
  }

  async function fetchModel(modelId: VoiceModelId): Promise<void> {
    const spec = VOICE_MODELS[modelId];
    const finalPath = modelPath(modelId);
    const progressStepBytes = spec.bytes / 100;
    const response = await deps.fetch(spec.url);
    if (!response.ok || response.body === null) {
      throw new VoiceError(`Falha ao baixar o modelo de voz (HTTP ${response.status}).`);
    }
    await mkdir(deps.modelDir, { recursive: true });
    const partPath = `${finalPath}.part`;
    const hash = createHash('sha256');
    const handle = await open(partPath, 'w');
    let receivedBytes = 0;
    let reportedBytes = 0;
    try {
      for await (const chunk of response.body) {
        hash.update(chunk);
        await handle.write(chunk);
        receivedBytes += chunk.byteLength;
        if (receivedBytes - reportedBytes >= progressStepBytes) {
          reportedBytes = receivedBytes;
          deps.onProgress({ modelId, receivedBytes, totalBytes: spec.bytes });
        }
      }
      await handle.close();
      if (receivedBytes !== spec.bytes || hash.digest('hex') !== spec.sha256) {
        throw new VoiceError('O modelo de voz baixado está corrompido. Tente de novo.');
      }
      await rename(partPath, finalPath);
      deps.onProgress({ modelId, receivedBytes, totalBytes: spec.bytes });
    } catch (error: unknown) {
      await handle.close();
      await rm(partPath, { force: true });
      throw error;
    }
  }

  async function status(): Promise<VoiceStatus> {
    const modelId = await deps.getModelId();
    const present = await Promise.all(VOICE_MODEL_IDS.map(hasModel));
    const installed = VOICE_MODEL_IDS.filter((_id, index) => present[index]);
    return {
      binary: (await findBinary()) !== undefined,
      model: installed.includes(modelId),
      modelBytes: VOICE_MODELS[modelId].bytes,
      modelId,
      installed,
      catalog: VOICE_MODEL_IDS.map((id) => ({
        id,
        label: VOICE_MODELS[id].label,
        bytes: VOICE_MODELS[id].bytes,
      })),
    };
  }

  return {
    status,

    async downloadModel(input) {
      const modelId = input?.modelId ?? (await deps.getModelId());
      let pending = downloads.get(modelId);
      if (pending === undefined) {
        pending = hasModel(modelId)
          .then((present) => (present ? undefined : fetchModel(modelId)))
          .finally(() => {
            downloads.delete(modelId);
          });
        downloads.set(modelId, pending);
      }
      return pending;
    },

    async deleteModel({ modelId }) {
      if (downloads.has(modelId)) {
        throw new VoiceError('O modelo está sendo baixado. Aguarde o fim do download.');
      }
      await rm(modelPath(modelId), { force: true });
      return status();
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
        const modelId = await deps.getModelId();
        if (!(await hasModel(modelId))) {
          throw new VoiceError('Modelo de voz não encontrado. Baixe o modelo antes de ditar.');
        }
        const wavPath = join(workDir, 'audio.wav');
        await writeFile(wavPath, encodeWav(input.pcm, VOICE_SAMPLE_RATE));
        const args = whisperArgs({
          modelPath: modelPath(modelId),
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

export function isVoiceModelId(value: unknown): value is VoiceModelId {
  return VOICE_MODEL_IDS.some((id) => id === value);
}

export function parseVoiceModelRequest(input: unknown): { modelId: VoiceModelId } | undefined {
  if (!isRecord(input) || !isVoiceModelId(input['modelId'])) return undefined;
  return { modelId: input['modelId'] };
}

export function parseVoiceDownload(input: unknown): { modelId?: VoiceModelId } | undefined {
  return input === undefined ? {} : parseVoiceModelRequest(input);
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
    downloadVoiceModel: (input?: unknown): Promise<Result<null>> => {
      const parsed = parseVoiceDownload(input);
      if (parsed === undefined) return Promise.resolve(fail('Modelo de voz inválido.'));
      return voiceGuarded(() => service.downloadModel(parsed).then(() => null));
    },
    deleteVoiceModel: (input: unknown): Promise<Result<VoiceStatus>> => {
      const parsed = parseVoiceModelRequest(input);
      if (parsed === undefined) return Promise.resolve(fail('Modelo de voz inválido.'));
      return voiceGuarded(() => service.deleteModel(parsed));
    },
    transcribeAudio: (input: unknown): Promise<Result<{ text: string }>> => {
      const parsed = parseTranscribe(input);
      if (parsed === undefined) return Promise.resolve(fail('Áudio inválido.'));
      return voiceGuarded(async () => ({ text: await service.transcribe(parsed) }));
    },
  };
}

export type VoiceHandlers = ReturnType<typeof createVoiceHandlers>;
