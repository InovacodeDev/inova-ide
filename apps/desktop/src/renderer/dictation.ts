import type { Settings } from '@inova/core/types';

export const DICTATION_SAMPLE_RATE = 16_000;
export const DICTATION_MAX_MS = 120_000;
export const DICTATION_INTERIM_MS = 2_000;

const VAD_FRAME_SAMPLES = 320;
const VAD_RMS_THRESHOLD = 0.003;
const VAD_PAD_FRAMES = 20;
const VAD_BRIDGE_FRAMES = 30;
const VAD_MAX_GAP_FRAMES = 40;
const VAD_KEEP_GAP_FRAMES = 10;
const PAUSE_SPLIT_MIN_SAMPLES = DICTATION_SAMPLE_RATE * 3;
const PAUSE_SPLIT_SILENCE_FRAMES = 30;
const DEFAULT_MAX_HINTS = 24;
const MAX_HINT_LENGTH = 120;

export function encodePcm16(chunks: readonly Float32Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clamped = Math.max(-1, Math.min(1, sample));
      samples[offset] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      offset += 1;
    }
  }
  return new Uint8Array(samples.buffer);
}

function flattenChunks(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function frameRms(samples: Float32Array, start: number, end: number): number {
  let energy = 0;
  for (let index = start; index < end; index += 1) {
    const value = samples[index] ?? 0;
    energy += value * value;
  }
  return Math.sqrt(energy / Math.max(1, end - start));
}

function activeSpeechRanges(
  samples: Float32Array,
  threshold: number,
): Array<{ start: number; end: number }> {
  const frameCount = Math.ceil(samples.length / VAD_FRAME_SAMPLES);
  const active = new Uint8Array(frameCount);
  let hasAny = false;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * VAD_FRAME_SAMPLES;
    const end = Math.min(samples.length, start + VAD_FRAME_SAMPLES);
    if (frameRms(samples, start, end) >= threshold) {
      active[frame] = 1;
      hasAny = true;
    }
  }
  if (!hasAny) return [];

  const padded = new Uint8Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (active[frame] === 1) {
      const from = Math.max(0, frame - VAD_PAD_FRAMES);
      const to = Math.min(frameCount - 1, frame + VAD_PAD_FRAMES);
      for (let idx = from; idx <= to; idx += 1) padded[idx] = 1;
    }
  }

  let silenceRun = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (padded[frame] === 0) {
      silenceRun += 1;
    } else {
      if (silenceRun > 0 && silenceRun <= VAD_BRIDGE_FRAMES && frame - silenceRun > 0) {
        for (let idx = frame - silenceRun; idx < frame; idx += 1) padded[idx] = 1;
      }
      silenceRun = 0;
    }
  }

  const ranges: Array<{ start: number; end: number }> = [];
  let rangeStart = -1;
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (padded[frame] === 1 && rangeStart === -1) {
      rangeStart = frame;
    } else if (padded[frame] === 0 && rangeStart !== -1) {
      ranges.push({ start: rangeStart, end: frame });
      rangeStart = -1;
    }
  }
  if (rangeStart !== -1) ranges.push({ start: rangeStart, end: frameCount });
  return ranges;
}

export function trimPcmSilence(
  chunks: readonly Float32Array[],
  options?: { threshold?: number },
): Float32Array[] {
  const samples = flattenChunks(chunks);
  if (samples.length === 0) return [];
  const ranges = activeSpeechRanges(samples, options?.threshold ?? VAD_RMS_THRESHOLD);
  if (ranges.length === 0) return [];

  const output: Float32Array[] = [];
  const gapSamples = VAD_KEEP_GAP_FRAMES * VAD_FRAME_SAMPLES;
  for (let index = 0; index < ranges.length; index += 1) {
    const current = ranges[index];
    if (!current) continue;
    const prev = index > 0 ? ranges[index - 1] : undefined;
    if (prev && current.start - prev.end > VAD_MAX_GAP_FRAMES) {
      output.push(new Float32Array(gapSamples));
    } else if (prev) {
      const midStart = prev.end * VAD_FRAME_SAMPLES;
      const midEnd = current.start * VAD_FRAME_SAMPLES;
      if (midEnd > midStart) output.push(samples.subarray(midStart, midEnd));
    }
    const sampleStart = current.start * VAD_FRAME_SAMPLES;
    const sampleEnd = Math.min(samples.length, current.end * VAD_FRAME_SAMPLES);
    output.push(samples.subarray(sampleStart, sampleEnd));
  }
  return output;
}

export function totalChunkSamples(chunks: readonly Float32Array[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.length, 0);
}

export function sliceChunksRange(
  chunks: readonly Float32Array[],
  startSample: number,
  endSample?: number,
): Float32Array[] {
  const start = Math.max(0, startSample);
  const limit = endSample ?? Number.POSITIVE_INFINITY;
  if (limit <= start) return [];
  const result: Float32Array[] = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const chunkEnd = cursor + chunk.length;
    if (chunkEnd > start && cursor < limit) {
      const from = Math.max(0, start - cursor);
      const to = Math.min(chunk.length, limit - cursor);
      if (to > from) {
        result.push(from === 0 && to === chunk.length ? chunk : chunk.subarray(from, to));
      }
    }
    cursor = chunkEnd;
    if (cursor >= limit) break;
  }
  return result;
}

export function findPauseSplitSample(
  chunks: readonly Float32Array[],
  fromSample: number,
  options?: { threshold?: number },
): number | null {
  const total = totalChunkSamples(chunks);
  if (total - fromSample < PAUSE_SPLIT_MIN_SAMPLES) return null;
  const windowChunks = sliceChunksRange(chunks, fromSample);
  const samples = flattenChunks(windowChunks);
  const frameCount = Math.floor(samples.length / VAD_FRAME_SAMPLES);
  const threshold = options?.threshold ?? VAD_RMS_THRESHOLD;

  let seenSpeech = false;
  let quietRun = 0;
  let bestSplitFrame: number | null = null;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * VAD_FRAME_SAMPLES;
    const rms = frameRms(samples, start, start + VAD_FRAME_SAMPLES);
    if (rms >= threshold) {
      seenSpeech = true;
      quietRun = 0;
    } else if (seenSpeech) {
      quietRun += 1;
      if (quietRun >= PAUSE_SPLIT_SILENCE_FRAMES) {
        bestSplitFrame = frame - Math.floor(quietRun / 2);
      }
    }
  }
  return bestSplitFrame !== null && bestSplitFrame > 0
    ? fromSample + bestSplitFrame * VAD_FRAME_SAMPLES
    : null;
}

function pushHint(list: string[], seen: Set<string>, raw: string, maxHints: number): void {
  if (list.length >= maxHints) return;
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (normalized === '' || normalized.length > MAX_HINT_LENGTH) return;
  const key = normalized.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  list.push(normalized);
}

function extractPathBasenames(text: string): string[] {
  // REGEX: capture filenames with common code/config extensions from tool payloads or file paths
  const pattern = /(?:^|[\s"'`(/\\])([A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8})(?=$|[\s"'`),:;])/g;
  const matches: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (name && !/^\d+\.\d+$/.test(name)) matches.push(name);
  }
  return matches;
}

function extractTechnicalTokens(text: string): string[] {
  // REGEX: capture camelCase, PascalCase, snake_case, kebab-case and dotted identifiers from pinned memory
  const pattern =
    /\b(?:[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+|[a-z]+(?:[A-Z][A-Za-z0-9]*)+|[A-Za-z0-9]+(?:[_.-][A-Za-z0-9]+)+)\b/g;
  return text.match(pattern) ?? [];
}

export function collectVoiceHints(input: {
  projectName?: string | null;
  branch?: string | null;
  attachedFiles?: readonly string[];
  recentToolInputs?: readonly string[];
  pinnedMemory?: string | null;
  customDictionary?: readonly string[];
  maxHints?: number;
}): string[] {
  const maxHints = input.maxHints ?? DEFAULT_MAX_HINTS;
  const hints: string[] = [];
  const seen = new Set<string>();

  if (input.customDictionary) {
    for (const term of input.customDictionary) pushHint(hints, seen, term, maxHints);
  }
  if (input.projectName) pushHint(hints, seen, input.projectName, maxHints);
  if (input.branch) pushHint(hints, seen, input.branch, maxHints);
  if (input.attachedFiles) {
    for (const filePath of input.attachedFiles) {
      const base = filePath.split(/[\\/]/).filter(Boolean).pop();
      if (base) pushHint(hints, seen, base, maxHints);
    }
  }
  if (input.recentToolInputs) {
    for (const raw of input.recentToolInputs) {
      for (const name of extractPathBasenames(raw)) pushHint(hints, seen, name, maxHints);
    }
  }
  if (input.pinnedMemory) {
    for (const token of extractTechnicalTokens(input.pinnedMemory)) {
      pushHint(hints, seen, token, maxHints);
    }
  }
  return hints;
}

export function dictationLanguage(locale: string): string {
  // REGEX: leading two-letter language of a BCP 47 tag such as pt-BR
  const match = /^([a-z]{2})(?:-|$)/i.exec(locale);
  return match?.[1]?.toLowerCase() ?? 'auto';
}

export function resolveDictationLanguage(input: {
  setting: Settings['voice']['language'] | undefined;
  locale: string;
}): string {
  const { setting, locale } = input;
  return setting === undefined || setting === 'auto' ? dictationLanguage(locale) : setting;
}

export function appendDictation(draft: string, text: string): string {
  const spoken = text.trim();
  if (spoken === '') return draft;
  if (draft === '' || /\s$/.test(draft)) return `${draft}${spoken}`;
  return `${draft} ${spoken}`;
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function parseCustomDictionary(raw: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const trimmed = part.replace(/\s+/g, ' ').trim();
    if (trimmed === '' || trimmed.length > 80) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(trimmed);
    if (items.length >= 100) break;
  }
  return items;
}
