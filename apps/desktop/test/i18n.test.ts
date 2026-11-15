import { describe, expect, test } from 'vitest';
import { MESSAGES, resolveLocale, translate, type TranslationKey } from '../src/renderer/i18n';

describe('resolveLocale', () => {
  test('uses explicit preference when set to pt-BR or en-US', () => {
    expect(resolveLocale('pt-BR', 'en-US')).toBe('pt-BR');
    expect(resolveLocale('en-US', 'pt-BR')).toBe('en-US');
  });

  test('detects English system locales when set to auto or undefined', () => {
    expect(resolveLocale('auto', 'en-US')).toBe('en-US');
    expect(resolveLocale('auto', 'en-GB')).toBe('en-US');
    expect(resolveLocale('auto', 'en')).toBe('en-US');
    expect(resolveLocale(undefined, 'en-AU')).toBe('en-US');
  });

  test('falls back to pt-BR for Portuguese and other system locales when auto', () => {
    expect(resolveLocale('auto', 'pt-BR')).toBe('pt-BR');
    expect(resolveLocale('auto', 'es-ES')).toBe('pt-BR');
    expect(resolveLocale(undefined, 'fr-FR')).toBe('pt-BR');
  });
});

describe('translate', () => {
  test('renders strings for pt-BR and en-US with parameter interpolation', () => {
    expect(translate('pt-BR', 'header.running', { count: 3 })).toBe('3 executando');
    expect(translate('en-US', 'header.running', { count: 3 })).toBe('3 running');
    expect(translate('en-US', 'sidebar.removeProjectDesc', { name: 'demo' })).toContain('"demo"');
  });

  test('keeps placeholder untouched when parameter is missing', () => {
    expect(translate('en-US', 'header.running', {})).toBe('{count} running');
  });

  test('maintains full key parity across pt-BR and en-US catalogs', () => {
    const ptKeys = Object.keys(MESSAGES['pt-BR']).sort();
    const enKeys = Object.keys(MESSAGES['en-US']).sort();
    expect(enKeys).toEqual(ptKeys);

    for (const key of ptKeys as TranslationKey[]) {
      expect(MESSAGES['pt-BR'][key].length).toBeGreaterThan(0);
      expect(MESSAGES['en-US'][key].length).toBeGreaterThan(0);
    }
  });
});
