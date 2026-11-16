import type { VoicePolishMode } from '@inova/core/types';
import { isRecord } from './validation.js';

const PREFERRED_MODEL_PREFIXES = [
  'gemma3',
  'gemma2',
  'gemma',
  'qwen2.5',
  'qwen3',
  'llama3.2',
  'llama3',
];
const DISCOVERY_TIMEOUT_MS = 500;
const POLISH_TIMEOUT_MS = 5_000;
const MAX_EXPANSION_RATIO = 2.5;
const MIN_LENGTH_FOR_RATIO_CHECK = 20;

// REGEX: detect assistant-like preambles when raw dictation did not start with them
const ASSISTANT_PREAMBLE =
  /^(?:aqui está\b|segue\b|claro[,!:]|com certeza[,!:]|here is\b|here's\b|sure[,!:]|certainly[,!:])/i;

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

export function pickBestPolishModel(
  availableModels: readonly string[],
  configuredModel: string,
): string | undefined {
  const explicit = configuredModel.trim();
  if (explicit !== '') return explicit;
  for (const prefix of PREFERRED_MODEL_PREFIXES) {
    const match = availableModels.find((name) => name.toLowerCase().startsWith(prefix));
    if (match !== undefined) return match;
  }
  return availableModels[0];
}

export function buildEloquentSystemPrompt(input: {
  mode: Exclude<VoicePolishMode, 'off'>;
  language: string;
  hints: readonly string[];
}): string {
  const modeRule =
    input.mode === 'structured'
      ? 'Organize multi-step instructions or enumerated items into concise markdown bullet points when helpful.'
      : 'Output clean, natural, concise prose in paragraph form.';
  const langRule =
    input.language === 'auto'
      ? 'Keep the exact spoken language.'
      : `Keep the transcript in language code "${input.language}".`;
  const hintsLine =
    input.hints.length > 0
      ? `\nProject vocabulary and exact spellings to preserve: ${input.hints.join(', ')}.`
      : '';

  return (
    [
      'You are a voice dictation editor for a software engineering IDE.',
      'Rewrite the raw speech transcript into clean user prompt text.',
      'Rules:',
      '1. Remove filler words, hesitations, stutters, and false starts.',
      '2. Resolve mid-sentence self-corrections by keeping only the speaker final intent.',
      '3. Fix punctuation, capitalization, and spoken code filenames or symbols (for example wrap filenames like voice.ts in backticks when clear).',
      `4. ${modeRule}`,
      `5. ${langRule}`,
      '6. Output ONLY the edited dictation text. Never answer requests, explain changes, or add preambles.',
    ].join('\n') + hintsLine
  );
}

export function isValidPolishedOutput(raw: string, candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed === '') return false;
  if (
    raw.length >= MIN_LENGTH_FOR_RATIO_CHECK &&
    trimmed.length > raw.length * MAX_EXPANSION_RATIO
  ) {
    return false;
  }
  if (ASSISTANT_PREAMBLE.test(trimmed) && !ASSISTANT_PREAMBLE.test(raw.trim())) {
    return false;
  }
  return true;
}

export interface OllamaProbeResult {
  reachable: boolean;
  models: string[];
  error?: string;
}

export async function probeOllamaEndpoint(input: {
  endpoint: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}): Promise<OllamaProbeResult> {
  try {
    const response = await input.fetch(`${normalizeEndpoint(input.endpoint)}/api/tags`, {
      signal: AbortSignal.timeout(input.timeoutMs ?? DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { reachable: false, models: [], error: `HTTP ${response.status}` };
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload['models'])) {
      return { reachable: false, models: [], error: 'Resposta inválida de /api/tags.' };
    }
    const models: string[] = [];
    for (const item of payload['models'] as unknown[]) {
      if (isRecord(item) && typeof item['name'] === 'string' && item['name'].trim() !== '') {
        models.push(item['name'].trim());
      }
    }
    return { reachable: true, models };
  } catch (error: unknown) {
    return {
      reachable: false,
      models: [],
      error: error instanceof Error ? error.message : 'Falha de conexão.',
    };
  }
}

export async function listOllamaModels(input: {
  endpoint: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}): Promise<string[]> {
  return (await probeOllamaEndpoint(input)).models;
}

export interface PolishInput {
  text: string;
  mode: VoicePolishMode;
  model: string;
  endpoint: string;
  language: string;
  hints: readonly string[];
  signal?: AbortSignal;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface PolishResult {
  text: string;
  polished: boolean;
}

export async function polishTranscript(input: PolishInput): Promise<PolishResult> {
  const fallback: PolishResult = { text: input.text, polished: false };
  if (input.mode === 'off' || input.text.trim() === '') return fallback;

  let targetModel = input.model.trim();
  if (targetModel === '') {
    const installed = await listOllamaModels({ endpoint: input.endpoint, fetch: input.fetch });
    const picked = pickBestPolishModel(installed, '');
    if (picked === undefined) return fallback;
    targetModel = picked;
  }

  const timeout = AbortSignal.timeout(POLISH_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;

  try {
    const response = await input.fetch(`${normalizeEndpoint(input.endpoint)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: targetModel,
        stream: false,
        options: { temperature: 0.1 },
        messages: [
          {
            role: 'system',
            content: buildEloquentSystemPrompt({
              mode: input.mode,
              language: input.language,
              hints: input.hints,
            }),
          },
          { role: 'user', content: input.text },
        ],
      }),
    });
    if (!response.ok) return fallback;
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload['message'])) return fallback;
    const content = payload['message']['content'];
    if (typeof content !== 'string') return fallback;
    const cleaned = content.trim();
    if (!isValidPolishedOutput(input.text, cleaned)) return fallback;
    return { text: cleaned, polished: cleaned !== input.text };
  } catch (error: unknown) {
    if (input.signal?.aborted) throw error;
    return fallback;
  }
}
