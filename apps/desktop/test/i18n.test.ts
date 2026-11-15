import { describe, expect, test } from 'vitest';
import { applyModeLabel, capabilityTabLabel } from '../src/renderer/capabilities-state';
import { paletteCategoryLabel } from '../src/renderer/command-palette-state';
import { buildFailoverNotice, describeFailoverBanner } from '../src/renderer/failover-notice';
import { MESSAGES, resolveLocale, translate, type TranslationKey } from '../src/renderer/i18n';
import { inspectorTabs } from '../src/renderer/inspector-state';
import { modeOptionText } from '../src/renderer/mode-picker-state';
import { effortLabel } from '../src/renderer/model-picker-state';
import { queueCountLabel, queuedCardLabel } from '../src/renderer/queue-state';
import { sessionStatusLabel } from '../src/renderer/session-status';
import { settingsSectionLabel } from '../src/renderer/settings-sections';
import { shortcutGroupLabel, shortcutLabel } from '../src/renderer/shortcuts';
import { presentTool } from '../src/renderer/tool-presentation';
import { activeTurnActivity, summarizeWork } from '../src/renderer/turn-groups';

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

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

  test('maintains key, non-empty, and placeholder parity across pt-BR and en-US catalogs', () => {
    const ptKeys = Object.keys(MESSAGES['pt-BR']).sort();
    const enKeys = Object.keys(MESSAGES['en-US']).sort();
    expect(enKeys).toEqual(ptKeys);

    for (const key of ptKeys as TranslationKey[]) {
      const ptValue = MESSAGES['pt-BR'][key];
      const enValue = MESSAGES['en-US'][key];
      expect(ptValue.length).toBeGreaterThan(0);
      expect(enValue.length).toBeGreaterThan(0);
      const ptParams = placeholders(ptValue);
      const enParams = placeholders(enValue);
      for (const param of enParams) {
        expect(ptParams, `unexpected placeholder {${param}} in key ${key}`).toContain(param);
      }
      if (key !== 'sidebar.inboxUnreadTooltip') {
        expect(enParams, `placeholder mismatch in key ${key}`).toEqual(ptParams);
      }
    }
  });
});

describe('localized renderer helpers', () => {
  test('localizes session statuses, settings sections, efforts, and modes', () => {
    expect(sessionStatusLabel('running', 'pt-BR')).toBe('Executando');
    expect(sessionStatusLabel('running', 'en-US')).toBe('Running');
    expect(settingsSectionLabel('general', 'en-US')).toBe('General');
    expect(effortLabel('high', 'pt-BR')).toBe('Alto');
    expect(effortLabel('high', 'en-US')).toBe('High');
    expect(
      modeOptionText(
        'claude',
        { id: 'accept-edits', label: 'Accept edits', description: '' },
        'pt-BR',
      ).label,
    ).toBe('Aceitar edições');
    expect(
      modeOptionText(
        'claude',
        { id: 'accept-edits', label: 'Accept edits', description: '' },
        'en-US',
      ).label,
    ).toBe('Accept edits');
  });

  test('localizes tools, turn activity, and work summary', () => {
    const shellTool = {
      id: 't1',
      type: 'tool' as const,
      name: 'Bash',
      input: '{"command":"pnpm test"}',
      output: null,
      isError: false,
    };
    const readTool = {
      id: 't2',
      type: 'tool' as const,
      name: 'Read',
      input: '{"file_path":"src/index.ts"}',
      output: null,
      isError: false,
    };
    expect(presentTool(readTool, 'en-US')).toMatchObject({ kind: 'lookup', label: 'Read' });
    expect(presentTool(readTool, 'pt-BR')).toMatchObject({ kind: 'lookup', label: 'Leitura' });
    expect(activeTurnActivity([shellTool], 'en-US')).toBe('Running command…');
    expect(activeTurnActivity([shellTool], 'pt-BR')).toBe('Executando comando…');
    expect(summarizeWork([{ item: shellTool, index: 0 }], 'en-US')).toBe('1 command');
    expect(summarizeWork([{ item: shellTool, index: 0 }], 'pt-BR')).toBe('1 comando');
  });

  test('localizes failover, queue, inspector, capability, palette, and shortcuts helpers', () => {
    const notice = buildFailoverNotice({
      fromAccount: {
        id: 'a1',
        provider: 'claude',
        label: 'pessoal',
        email: null,
        status: 'logged-in',
      },
      toAccount: {
        id: 'a2',
        provider: 'codex',
        label: 'work',
        email: null,
        status: 'logged-in',
      },
      rollbackLastTurn: true,
      locale: 'en-US',
    });
    expect(notice.toDisplay).toContain('Codex');
    expect(describeFailoverBanner(notice, 'en-US').acceptLabel).toContain('Continue with');
    expect(queueCountLabel(2, 'en-US')).toBe('2 queued');
    expect(queuedCardLabel(true, 'en-US')).toContain('Queued');
    expect(inspectorTabs({ subagents: [], worktreeBranch: null, locale: 'en-US' })[0]?.label).toBe(
      'Context',
    );
    expect(capabilityTabLabel('skill', 'en-US')).toBe('Skills');
    expect(applyModeLabel('launch', 'en-US')).toBe('Inova only');
    expect(paletteCategoryLabel('Sessões', 'en-US')).toBe('Sessions');
    expect(shortcutGroupLabel('Sessões', 'en-US')).toBe('Sessions');
    expect(shortcutLabel('new-session', 'en-US')).toBe('New session');
  });
});
