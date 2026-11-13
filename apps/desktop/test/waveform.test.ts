import { expect, test } from 'vitest';
import { barHeights, WAVEFORM_MIN_HEIGHT } from '../src/renderer/waveform.js';

test('barHeights returns the minimum height for silence and empty input', () => {
  expect(barHeights({ samples: new Uint8Array(8).fill(128), bars: 4 })).toEqual(
    new Array(4).fill(WAVEFORM_MIN_HEIGHT),
  );
  expect(barHeights({ samples: new Uint8Array(0), bars: 3 })).toEqual(
    new Array(3).fill(WAVEFORM_MIN_HEIGHT),
  );
});

test('barHeights takes the peak per bucket on both polarities and clamps to 1', () => {
  const samples = new Uint8Array([128, 128, 255, 128, 0, 128, 128, 128]);
  const heights = barHeights({ samples, bars: 4 });
  expect(heights).toHaveLength(4);
  expect(heights[0]).toBe(WAVEFORM_MIN_HEIGHT);
  expect(heights[1]).toBe(1);
  expect(heights[2]).toBe(1);
  expect(heights[3]).toBe(WAVEFORM_MIN_HEIGHT);
});

test('barHeights scales quiet input and handles more bars than samples', () => {
  const quiet = barHeights({ samples: new Uint8Array([138]), bars: 1 });
  expect(quiet[0]).toBeCloseTo((10 / 128) * 3, 5);
  const sparse = barHeights({ samples: new Uint8Array([255, 128]), bars: 5 });
  expect(sparse).toHaveLength(5);
  expect(sparse.every((value) => value >= WAVEFORM_MIN_HEIGHT && value <= 1)).toBe(true);
});
