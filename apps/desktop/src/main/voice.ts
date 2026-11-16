import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VOICE_MODEL_IDS,
  VOICE_POLISH_MODES,
  isPolishEndpointUrl,
  resolveVoicePolishSettings,
} from '@inova/core/settings';
import type { Settings, VoiceModelId, VoicePolishMode } from '@inova/core/types';
import type {
  Result,
  VoiceModelProgress,
  VoicePolishCheckResult,
  VoiceStatus,
} from '../shared/api.js';
import { fail, isRecord, ok } from './validation.js';
import type { OllamaProbeResult, PolishInput, PolishResult } from './voice-polish.js';
import type { WhisperServerHandle } from './whisper-server.js';

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
const MAX_HINTS = 24;
const MAX_HINT_CHARS = 120;
const GLOSSARY =
  'TypeScript, JavaScript, React, Node, API, JSON, middleware, helper, token, commit, branch, merge, pull request, deploy, endpoint, regex, localhost';
const INSTALL_HINT = 'Instale o whisper.cpp (macOS: brew install whisper-cpp).';

// REGEX: common Whisper silence/outro hallucinations emitted on low-energy segments
const WHISPER_HALLUCINATIONS =
  /(?:^|(?<=[.!?]))\s*(?:obrigado por assistir(?:\s+a\s+este\s+v[ií]deo)?|legendas?\s+pela\s+comunidade(?:\s+\S+)*|inscreva-se\s+no\s+canal|thanks?\s+for\s+watching|subtitles?\s+by\s+\S+|amara\.org|gracias\s+por\s+ver(?:\s+este\s+v[ií]deo)?)[.!?\s]*$/gi;
// REGEX: unambiguous hesitation vocalizations and ellipsis-marked hesitations (e.g. "É...", "Ah...")
const HESITATION_FILLERS =
  /(?:^|(?<=[\s,.;:!?]))(?:[eé]+(?:\s*(?:\.\.\.|…)+)+|(?:h[aã]m?|hum+|uhm+|uh+|ahn+|aham+|e+h+|a+h+|o+h+)(?=[,.\s!?;:…]|$)(?:\s*[,.…]+)?)/gi;
// REGEX: English-specific fillers ("um", "er") kept safe from Portuguese "um" unless comma/ellipsis-delimited
const PAUSED_UM_ER = /(?:^|(?<=[\s,.;:!?]))(?:um+|er+)(?=\s*(?:,|\.\.\.|…))\s*(?:,|\.\.\.|…)+/gi;
const EN_UM_ER = /(?:^|(?<=[\s,.;:!?]))(?:um+|er+)(?=[,.\s!?;:]|$)(?:\s*[,.…]+)?/gi;
// REGEX: repeated words across commas or ellipses from spoken stutters (e.g. "vai... vai", "eu, eu")
const PAUSED_STUTTER = /\b(\p{L}{1,15})(?:\s*(?:,|\.\.\.|…)+\s*\1\b)+/giu;
// REGEX: repeated short words/pronouns/articles from spoken stutters
const IMMEDIATE_STUTTER =
  /\b(eu|você|ele|ela|nós|o|a|os|as|um|uma|de|do|da|em|no|na|por|para|pra|com|que|se|e|mas|the|a|an|i|you|we|it|to|of|in|on|for|is|are|and|that|el|la|los|las|un|una|de|en|por|para|que|y)\b(?:\s+\1\b)+/gi;

const LANGUAGE_DISCOURSE_FILLERS: Readonly<Record<string, readonly RegExp[]>> = {
  pt: [
    // REGEX: comma-isolated Portuguese filler phrases that do not alter grammatical clauses
    /(?:^|,\s*)(?:tipo\s+assim|tipo|né|sabe|então,\s*tipo|entendeu)(?=\s*,|\s*\.\.\.)\s*(?:,|\.\.\.)+/gi,
  ],
  en: [
    // REGEX: comma-isolated English discourse fillers
    /(?:^|,\s*)(?:you\s+know|i\s+mean|sort\s+of|kind\s+of|like)(?=\s*,|\s*\.\.\.)\s*(?:,|\.\.\.)+/gi,
  ],
  es: [
    // REGEX: comma-isolated Spanish discourse fillers
    /(?:^|,\s*)(?:o\s+sea|pues|este)(?=\s*,|\s*\.\.\.)\s*(?:,|\.\.\.)+/gi,
  ],
};

export class VoiceError extends Error {}

export interface TranscribeInput {
  pcm: Uint8Array;
  final: boolean;
  language: string;
  hints: string[];
  polishMode?: VoicePolishMode;
}

export interface TranscribeResult {
  text: string;
  rawText: string;
  polished: boolean;
}

const SERVER_IDLE_MS = 5 * 60 * 1000;

export interface VoiceDeps {
  modelDir: string;
  getModelId: () => Promise<VoiceModelId>;
  getVoiceSettings?: () => Promise<Settings['voice']>;
  binaryCandidates: readonly string[];
  findOnPath: () => Promise<string | undefined>;
  runWhisper: (input: { file: string; args: string[]; signal: AbortSignal }) => Promise<string>;
  serverBinaryCandidates?: readonly string[];
  findServerOnPath?: () => Promise<string | undefined>;
  startServer?: (input: { binary: string; modelPath: string }) => Promise<WhisperServerHandle>;
  serverIdleMs?: number;
  polish?: (input: PolishInput) => Promise<PolishResult>;
  listPolishModels?: (input: {
    endpoint: string;
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
  }) => Promise<string[]>;
  probePolishEndpoint?: (input: {
    endpoint: string;
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
  }) => Promise<OllamaProbeResult>;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  onProgress: (progress: VoiceModelProgress) => void;
}

export interface VoiceService {
  status(): Promise<VoiceStatus>;
  checkPolish(input?: { endpoint?: string }): Promise<VoicePolishCheckResult>;
  downloadModel(input?: { modelId?: VoiceModelId }): Promise<void>;
  deleteModel(input: { modelId: VoiceModelId }): Promise<VoiceStatus>;
  transcribe(input: TranscribeInput): Promise<string>;
  transcribeDetailed(input: TranscribeInput): Promise<TranscribeResult>;
  dispose(): Promise<void>;
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

function discourseFillersFor(language?: string): readonly RegExp[] {
  if (language === undefined || language === 'auto') {
    return [
      ...(LANGUAGE_DISCOURSE_FILLERS['pt'] ?? []),
      ...(LANGUAGE_DISCOURSE_FILLERS['en'] ?? []),
      ...(LANGUAGE_DISCOURSE_FILLERS['es'] ?? []),
    ];
  }
  return LANGUAGE_DISCOURSE_FILLERS[language] ?? [];
}

export function stripNonSpeechAnnotations(stdout: string): string {
  // REGEX: drop whisper non-speech annotations such as [BLANK_AUDIO], [Música] or (risos)
  const annotations = /\[[^\]\n]*\]|\([^)\n]*\)/g;
  return stdout.replace(annotations, ' ').replace(/\s+/g, ' ').trim();
}

export function cleanTranscript(stdout: string, language?: string): string {
  let text = stripNonSpeechAnnotations(stdout).replace(WHISPER_HALLUCINATIONS, ' ');
  for (const pattern of discourseFillersFor(language)) {
    text = text.replace(pattern, ' ');
  }
  text = text.replace(HESITATION_FILLERS, ' ');
  text = text.replace(language === 'en' ? EN_UM_ER : PAUSED_UM_ER, ' ');
  text = text.replace(PAUSED_STUTTER, '$1');
  text = text.replace(IMMEDIATE_STUTTER, '$1');
  // REGEX: normalize punctuation spacing and drop stray leading/duplicate commas left by filler removal
  return text
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;])\s*(?:[,;]\s*)+/g, '$1 ')
    .replace(/^[\s,;]+/, '')
    .replace(/[,;]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  let server: WhisperServerHandle | null = null;
  let serverBoot: Promise<WhisperServerHandle> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function modelPath(modelId: VoiceModelId): string {
    return join(deps.modelDir, VOICE_MODELS[modelId].file);
  }

  function hasModel(modelId: VoiceModelId): Promise<boolean> {
    return isFile(modelPath(modelId), VOICE_MODELS[modelId].bytes);
  }

  async function findBinaryFrom(
    candidates: readonly string[],
    fallback: () => Promise<string | undefined>,
  ): Promise<string | undefined> {
    for (const candidate of candidates) {
      if (await isFile(candidate)) return candidate;
    }
    return fallback();
  }

  function findBinary(): Promise<string | undefined> {
    return findBinaryFrom(deps.binaryCandidates, deps.findOnPath);
  }

  function findServerBinary(): Promise<string | undefined> {
    if (!deps.startServer) return Promise.resolve(undefined);
    return findBinaryFrom(
      deps.serverBinaryCandidates ?? [],
      deps.findServerOnPath ?? (() => Promise.resolve(undefined)),
    );
  }

  function clearIdleTimer(): void {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  async function stopServer(): Promise<void> {
    clearIdleTimer();
    const pending = serverBoot;
    serverBoot = null;
    if (pending !== null) {
      try {
        const started = await pending;
        await started.stop();
      } catch {
        server = null;
      }
    }
    if (server !== null) {
      const handle = server;
      server = null;
      await handle.stop();
    }
  }

  function touchIdleTimer(): void {
    clearIdleTimer();
    const delayMs = deps.serverIdleMs ?? SERVER_IDLE_MS;
    if (delayMs <= 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      void stopServer();
    }, delayMs);
    idleTimer.unref?.();
  }

  async function ensureServer(
    binary: string,
    targetModelPath: string,
  ): Promise<WhisperServerHandle> {
    if (server !== null && server.modelPath === targetModelPath) {
      touchIdleTimer();
      return server;
    }
    if (server !== null && server.modelPath !== targetModelPath) {
      await stopServer();
    }
    if (serverBoot !== null) {
      const booted = await serverBoot;
      if (booted.modelPath === targetModelPath) {
        touchIdleTimer();
        return booted;
      }
      await stopServer();
    }
    const startServer = deps.startServer;
    if (!startServer) throw new VoiceError('whisper-server indisponível.');
    const boot = startServer({ binary, modelPath: targetModelPath }).then((handle) => {
      server = handle;
      return handle;
    });
    serverBoot = boot;
    try {
      const handle = await boot;
      touchIdleTimer();
      return handle;
    } finally {
      if (serverBoot === boot) serverBoot = null;
    }
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
    const hasCli = (await findBinary()) !== undefined;
    const hasServer = (await findServerBinary()) !== undefined;
    let polishModels: string[] | undefined;
    if (deps.listPolishModels) {
      const voiceSettings = deps.getVoiceSettings
        ? await deps.getVoiceSettings()
        : { language: 'auto' as const, modelId };
      const polishConfig = resolveVoicePolishSettings(voiceSettings);
      polishModels = await deps.listPolishModels({
        endpoint: polishConfig.endpoint,
        fetch: deps.fetch,
      });
    }
    return {
      binary: hasCli || hasServer,
      server: hasServer,
      model: installed.includes(modelId),
      modelBytes: VOICE_MODELS[modelId].bytes,
      modelId,
      installed,
      catalog: VOICE_MODEL_IDS.map((id) => ({
        id,
        label: VOICE_MODELS[id].label,
        bytes: VOICE_MODELS[id].bytes,
      })),
      ...(polishModels !== undefined ? { polishModels } : {}),
    };
  }

  async function checkPolish(input?: { endpoint?: string }): Promise<VoicePolishCheckResult> {
    const modelId = await deps.getModelId();
    const voiceSettings = deps.getVoiceSettings
      ? await deps.getVoiceSettings()
      : { language: 'auto' as const, modelId };
    const configured = resolveVoicePolishSettings(voiceSettings).endpoint;
    const rawEndpoint = input?.endpoint?.trim() || configured;
    if (!isPolishEndpointUrl(rawEndpoint)) {
      throw new VoiceError(
        'Endereço inválido. Use http://127.0.0.1, http://localhost ou https://.',
      );
    }
    const checkedAt = new Date().toISOString();
    if (deps.probePolishEndpoint) {
      const probe = await deps.probePolishEndpoint({ endpoint: rawEndpoint, fetch: deps.fetch });
      return {
        endpoint: rawEndpoint,
        reachable: probe.reachable,
        models: probe.models,
        checkedAt,
        ...(probe.error !== undefined ? { error: probe.error } : {}),
      };
    }
    const models = deps.listPolishModels
      ? await deps.listPolishModels({ endpoint: rawEndpoint, fetch: deps.fetch })
      : [];
    return {
      endpoint: rawEndpoint,
      reachable: models.length > 0,
      models,
      checkedAt,
    };
  }

  async function runViaCli(input: {
    file: string;
    modelId: VoiceModelId;
    wav: Buffer;
    language: string;
    prompt: string;
    signal: AbortSignal;
  }): Promise<string> {
    const workDir = await mkdtemp(join(tmpdir(), 'inova-voice-'));
    try {
      const wavPath = join(workDir, 'audio.wav');
      await writeFile(wavPath, input.wav);
      const args = whisperArgs({
        modelPath: modelPath(input.modelId),
        wavPath,
        language: input.language,
        prompt: input.prompt,
      });
      return await deps.runWhisper({ file: input.file, args, signal: input.signal });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async function transcribeDetailed(input: TranscribeInput): Promise<TranscribeResult> {
    if (input.pcm.byteLength < MIN_AUDIO_BYTES) {
      return { text: '', rawText: '', polished: false };
    }
    if (active !== null) {
      if (!input.final) throw new VoiceError('Transcrição em andamento.');
      active.abort();
    }
    const controller = new AbortController();
    active = controller;
    try {
      const [serverBinary, cliBinary] = await Promise.all([findServerBinary(), findBinary()]);
      if (serverBinary === undefined && cliBinary === undefined) {
        throw new VoiceError(`whisper-cli não encontrado. ${INSTALL_HINT}`);
      }
      const modelId = await deps.getModelId();
      if (!(await hasModel(modelId))) {
        throw new VoiceError('Modelo de voz não encontrado. Baixe o modelo antes de ditar.');
      }
      const voiceSettings = deps.getVoiceSettings
        ? await deps.getVoiceSettings()
        : { language: 'auto' as const, modelId };
      const polishConfig = resolveVoicePolishSettings(voiceSettings);
      const mergedHints = [...polishConfig.customDictionary, ...input.hints].slice(0, MAX_HINTS);
      const wav = encodeWav(input.pcm, VOICE_SAMPLE_RATE);
      const prompt = buildVoicePrompt(mergedHints);
      let stdout: string;
      if (serverBinary !== undefined) {
        try {
          const handle = await ensureServer(serverBinary, modelPath(modelId));
          stdout = await handle.transcribe({
            wav,
            language: input.language,
            prompt,
            signal: controller.signal,
          });
          touchIdleTimer();
        } catch (error: unknown) {
          if (controller.signal.aborted || cliBinary === undefined) throw error;
          await stopServer();
          stdout = await runViaCli({
            file: cliBinary,
            modelId,
            wav,
            language: input.language,
            prompt,
            signal: controller.signal,
          });
        }
      } else {
        if (cliBinary === undefined) {
          throw new VoiceError(`whisper-cli não encontrado. ${INSTALL_HINT}`);
        }
        stdout = await runViaCli({
          file: cliBinary,
          modelId,
          wav,
          language: input.language,
          prompt,
          signal: controller.signal,
        });
      }
      if (!input.final) {
        const preview = stripNonSpeechAnnotations(stdout);
        return { text: preview, rawText: preview, polished: false };
      }
      const rawText = cleanTranscript(stdout, input.language);
      const effectiveMode = input.polishMode ?? polishConfig.mode;
      if (effectiveMode === 'off' || rawText === '' || !deps.polish) {
        return { text: rawText, rawText, polished: false };
      }
      const polished = await deps.polish({
        text: rawText,
        mode: effectiveMode,
        model: polishConfig.model,
        endpoint: polishConfig.endpoint,
        language: input.language,
        hints: mergedHints,
        signal: controller.signal,
        fetch: deps.fetch,
      });
      return { text: polished.text, rawText, polished: polished.polished };
    } finally {
      if (active === controller) active = null;
    }
  }

  return {
    status,

    checkPolish,

    dispose: stopServer,

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
      if (server !== null && server.modelPath === modelPath(modelId)) {
        await stopServer();
      }
      await rm(modelPath(modelId), { force: true });
      return status();
    },

    transcribeDetailed,

    async transcribe(input) {
      return (await transcribeDetailed(input)).text;
    },
  };
}

export function isVoicePolishMode(value: unknown): value is VoicePolishMode {
  return VOICE_POLISH_MODES.some((mode) => mode === value);
}

export function parseTranscribe(input: unknown): TranscribeInput | undefined {
  if (!isRecord(input)) return undefined;
  const { pcm, final, language, hints, polishMode } = input;
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
  if (polishMode !== undefined && !isVoicePolishMode(polishMode)) return undefined;
  return {
    pcm,
    final,
    language,
    hints: safeHints.map((hint) => hint.replace(/\s+/g, ' ')),
    ...(polishMode !== undefined ? { polishMode } : {}),
  };
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

export function parseVoicePolishCheck(input: unknown): { endpoint?: string } | undefined {
  if (input === undefined) return {};
  if (!isRecord(input)) return undefined;
  const endpoint = input['endpoint'];
  if (endpoint === undefined) return {};
  if (typeof endpoint !== 'string') return undefined;
  return { endpoint };
}

export function createVoiceHandlers(service: VoiceService) {
  return {
    getVoiceStatus: (): Promise<Result<VoiceStatus>> => voiceGuarded(() => service.status()),
    checkVoicePolish: (input?: unknown): Promise<Result<VoicePolishCheckResult>> => {
      const parsed = parseVoicePolishCheck(input);
      if (parsed === undefined) return Promise.resolve(fail('Endereço inválido.'));
      return voiceGuarded(() => service.checkPolish(parsed));
    },
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
    transcribeAudio: (input: unknown): Promise<Result<TranscribeResult>> => {
      const parsed = parseTranscribe(input);
      if (parsed === undefined) return Promise.resolve(fail('Áudio inválido.'));
      return voiceGuarded(() => service.transcribeDetailed(parsed));
    },
  };
}

export type VoiceHandlers = ReturnType<typeof createVoiceHandlers>;
