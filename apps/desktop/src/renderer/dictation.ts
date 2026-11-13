export const DICTATION_SAMPLE_RATE = 16_000;
export const DICTATION_MAX_MS = 120_000;
export const DICTATION_INTERIM_MS = 2_000;

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

export function dictationLanguage(locale: string): string {
  // REGEX: leading two-letter language of a BCP 47 tag such as pt-BR
  const match = /^([a-z]{2})(?:-|$)/i.exec(locale);
  return match?.[1]?.toLowerCase() ?? 'auto';
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
