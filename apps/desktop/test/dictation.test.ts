import { expect, test } from 'vitest';
import {
  appendDictation,
  dictationLanguage,
  encodePcm16,
  formatMegabytes,
} from '../src/renderer/dictation.js';

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

test('appendDictation inserts a single separating space', () => {
  expect(appendDictation('', ' olá ')).toBe('olá');
  expect(appendDictation('revise', 'o arquivo')).toBe('revise o arquivo');
  expect(appendDictation('revise\n', 'o arquivo')).toBe('revise\no arquivo');
  expect(appendDictation('revise', '   ')).toBe('revise');
});

test('formatMegabytes rounds to whole megabytes', () => {
  expect(formatMegabytes(190_085_487)).toBe('181 MB');
});
