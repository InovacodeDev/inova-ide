export const WAVEFORM_BARS = 20;
export const WAVEFORM_MIN_HEIGHT = 0.12;
const WAVEFORM_GAIN = 3;
const SILENCE = 128;

export function barHeights(input: { samples: Uint8Array; bars: number }): number[] {
  const { samples, bars } = input;
  const heights = new Array<number>(bars).fill(WAVEFORM_MIN_HEIGHT);
  if (samples.length === 0 || bars <= 0) return heights;
  const bucket = samples.length / bars;
  for (let index = 0; index < bars; index += 1) {
    const start = Math.floor(index * bucket);
    const end = Math.max(start + 1, Math.floor((index + 1) * bucket));
    let peak = 0;
    for (let at = start; at < end && at < samples.length; at += 1) {
      peak = Math.max(peak, Math.abs((samples[at] ?? SILENCE) - SILENCE) / SILENCE);
    }
    heights[index] = Math.min(1, Math.max(WAVEFORM_MIN_HEIGHT, peak * WAVEFORM_GAIN));
  }
  return heights;
}
