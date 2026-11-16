import { describe, expect, test } from 'vitest';
import {
  appendDictation,
  collectVoiceHints,
  dictationLanguage,
  encodePcm16,
  findPauseSplitSample,
  formatMegabytes,
  parseCustomDictionary,
  resolveDictationLanguage,
  sliceChunksRange,
  totalChunkSamples,
  trimPcmSilence,
} from '../src/renderer/dictation.js';

function tone(samples: number, amplitude = 0.2): Float32Array {
  const buffer = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    buffer[i] = Math.sin(i * 0.2) * amplitude;
  }
  return buffer;
}

test('encodePcm16 joins chunks, clamps samples and writes little-endian 16-bit', () => {
  const bytes = encodePcm16([new Float32Array([0, 1, -1]), new Float32Array([2, -2, 0.5])]);
  const samples = new Int16Array(bytes.buffer);
  expect([...samples]).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  expect(bytes.byteLength).toBe(12);
  expect(encodePcm16([]).byteLength).toBe(0);
});

test('dictationLanguage keeps the two-letter language and falls back to auto', () => {
  expect(dictationLanguage('pt-BR')).toBe('pt');
  expect(dictationLanguage('EN')).toBe('en');
  expect(dictationLanguage('')).toBe('auto');
  expect(dictationLanguage('fil-PH')).toBe('auto');
});

test('resolveDictationLanguage sends an explicit setting and detects the locale otherwise', () => {
  expect(resolveDictationLanguage({ setting: 'es', locale: 'pt-BR' })).toBe('es');
  expect(resolveDictationLanguage({ setting: 'auto', locale: 'pt-BR' })).toBe('pt');
  expect(resolveDictationLanguage({ setting: undefined, locale: 'en-US' })).toBe('en');
  expect(resolveDictationLanguage({ setting: undefined, locale: '' })).toBe('auto');
});

test('appendDictation inserts a single separating space', () => {
  expect(appendDictation('', ' olá ')).toBe('olá');
  expect(appendDictation('revise', 'o arquivo')).toBe('revise o arquivo');
  expect(appendDictation('revise\n', 'o arquivo')).toBe('revise\no arquivo');
  expect(appendDictation('revise', '   ')).toBe('revise');
});

test('formatMegabytes rounds to whole megabytes', () => {
  expect(formatMegabytes(190_085_487)).toBe('181 MB');
});

describe('trimPcmSilence', () => {
  test('returns an empty array for silence-only audio', () => {
    expect(trimPcmSilence([])).toEqual([]);
    expect(trimPcmSilence([new Float32Array(16_000)])).toEqual([]);
    expect(trimPcmSilence([tone(16_000, 0.001)])).toEqual([]);
  });

  test('trims long leading and trailing silence while preserving speech padding', () => {
    const leadingSilence = new Float32Array(32_000);
    const speech = tone(6_400, 0.25);
    const trailingSilence = new Float32Array(32_000);
    const trimmed = trimPcmSilence([leadingSilence, speech, trailingSilence]);
    const totalSamples = trimmed.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(totalSamples).toBeGreaterThan(speech.length);
    expect(totalSamples).toBeLessThan(20_000);
  });

  test('collapses very long internal silence gaps without dropping subsequent speech', () => {
    const first = tone(3_200, 0.25);
    const longPause = new Float32Array(48_000);
    const second = tone(3_200, 0.25);
    const trimmed = trimPcmSilence([first, longPause, second]);
    const totalSamples = trimmed.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(totalSamples).toBeGreaterThan(first.length + second.length);
    expect(totalSamples).toBeLessThan(35_000);
  });
});

describe('collectVoiceHints', () => {
  test('deduplicates and extracts file names and technical tokens within maxHints', () => {
    const hints = collectVoiceHints({
      projectName: 'inova-ide',
      branch: 'feat/voice-v2',
      attachedFiles: ['/repo/apps/desktop/src/main/voice.ts'],
      recentToolInputs: ['{"file_path":"src/renderer/useDictation.ts","extra":"voice.ts"}'],
      pinnedMemory: 'Sempre rodar pnpm_typecheck e manter InovaIDE compatível com whisper-cli.',
      customDictionary: ['Gemma', 'inova-ide'],
    });
    expect(hints).toContain('Gemma');
    expect(hints).toContain('inova-ide');
    expect(hints).toContain('feat/voice-v2');
    expect(hints).toContain('voice.ts');
    expect(hints).toContain('useDictation.ts');
    expect(hints).toContain('InovaIDE');
    expect(hints).toContain('whisper-cli');
    expect(hints.filter((item) => item.toLowerCase() === 'inova-ide')).toHaveLength(1);
    expect(hints.filter((item) => item.toLowerCase() === 'voice.ts')).toHaveLength(1);
  });

  test('respects maxHints limit', () => {
    const hints = collectVoiceHints({
      customDictionary: ['a', 'b', 'c', 'd', 'e'],
      maxHints: 3,
    });
    expect(hints).toEqual(['a', 'b', 'c']);
  });
});

describe('incremental chunk slicing', () => {
  test('slices exact sample ranges across chunk boundaries', () => {
    const chunks = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6, 7])];
    expect(totalChunkSamples(chunks)).toBe(7);
    const sliced = sliceChunksRange(chunks, 2, 5);
    expect(sliced.map((c) => [...c])).toEqual([[3], [4, 5]]);
    expect(sliceChunksRange(chunks, 7)).toEqual([]);
  });

  test('findPauseSplitSample locates a silence gap after speech without splitting continuous speech', () => {
    const first = tone(16_000 * 3, 0.2);
    const pause = new Float32Array(16_000 * 1);
    const second = tone(16_000 * 1, 0.2);
    const split = findPauseSplitSample([first, pause, second], 0);
    expect(split).not.toBeNull();
    expect(split ?? 0).toBeGreaterThanOrEqual(16_000 * 3);
    expect(split ?? 0).toBeLessThanOrEqual(16_000 * 4);

    expect(findPauseSplitSample([tone(16_000 * 4, 0.2)], 0)).toBeNull();
  });

  test('parseCustomDictionary splits commas and newlines while deduplicating', () => {
    expect(parseCustomDictionary('InovaIDE, gemma3:4b\n inovaide ,  whisper-server \n')).toEqual([
      'InovaIDE',
      'gemma3:4b',
      'whisper-server',
    ]);
  });
});
