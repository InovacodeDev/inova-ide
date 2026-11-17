import { describe, expect, test } from 'vitest';
import {
  buildCommandPaletteItems,
  buildViewerPaletteActions,
  filterCommandPaletteItems,
  groupCommandPaletteItems,
  moveCommandPaletteIndex,
} from '../src/renderer/command-palette-state';

describe('command-palette-state', () => {
  const sampleItems = buildCommandPaletteItems({
    actions: [
      {
        id: 'action:new-session',
        title: 'Nova sessão',
        subtitle: 'Abrir formulário de nova sessão',
        shortcutId: 'new-session',
        keywords: ['criar', 'chat'],
      },
      {
        id: 'action:open-git-diff',
        title: 'Inspecionar diff Git da sessão',
        keywords: ['alteracoes', 'diff'],
      },
    ],
    sessions: [
      {
        id: 's-archived',
        title: 'Sessão antiga',
        projectName: 'inova-ide',
        providerLabel: 'Claude',
        branch: null,
        active: false,
        archived: true,
      },
      {
        id: 's-active',
        title: 'Command Palette UI',
        projectName: 'inova-ide',
        providerLabel: 'Claude',
        branch: 'feat/rich-chat-ui',
        active: true,
        archived: false,
      },
      {
        id: 's-idle',
        title: 'Corrigir parser markdown',
        projectName: 'docs-site',
        providerLabel: 'Codex',
        branch: null,
        active: false,
        archived: false,
      },
    ],
    projects: [
      {
        id: 'p-1',
        name: 'inova-ide',
        path: '/repo/inova-ide',
        accountLabel: 'claude-pro',
      },
    ],
    models: [
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', active: true },
      { id: 'claude-opus-4-6', label: 'Opus 4.6', active: false },
    ],
    modes: [
      { id: 'accept-edits', label: 'Aceitar edições', active: true },
      { id: 'plan', label: 'Plano', active: false },
    ],
  });

  test('buildCommandPaletteItems orders active session before regular and archived sessions', () => {
    const sessionTitles = sampleItems
      .filter((item) => item.category === 'Sessões')
      .map((item) => ({ id: item.id, badge: item.badge }));
    expect(sessionTitles).toEqual([
      { id: 'session:s-active', badge: 'Ativa' },
      { id: 'session:s-idle', badge: undefined },
      { id: 'session:s-archived', badge: 'Arquivada' },
    ]);

    expect(sampleItems.find((item) => item.id === 'project:p-1')?.badge).toBe('Nova sessão');
    expect(sampleItems.find((item) => item.id === 'model:claude-sonnet-4-6')?.badge).toBe('Atual');
    expect(sampleItems.find((item) => item.id === 'mode:accept-edits')?.badge).toBe('Atual');
  });

  test('filterCommandPaletteItems supports multi-token matching and prioritizes title prefix', () => {
    expect(filterCommandPaletteItems(sampleItems, '').length).toBe(sampleItems.length);

    const multiToken = filterCommandPaletteItems(sampleItems, 'docs-site markdown');
    expect(multiToken.map((item) => item.id)).toEqual(['session:s-idle']);

    const opus = filterCommandPaletteItems(sampleItems, 'opus');
    expect(opus.map((item) => item.id)).toEqual(['model:claude-opus-4-6']);

    const priority = filterCommandPaletteItems(sampleItems, 'inova-ide');
    expect(priority[0]?.id).toBe('project:p-1');
  });

  test('groupCommandPaletteItems groups non-empty categories in canonical order', () => {
    const groups = groupCommandPaletteItems(sampleItems);
    expect(groups.map((g) => g.category)).toEqual([
      'Ações',
      'Sessões',
      'Projetos',
      'Modelos',
      'Modos',
    ]);

    const filtered = filterCommandPaletteItems(sampleItems, 'plano');
    const filteredGroups = groupCommandPaletteItems(filtered);
    expect(filteredGroups.map((g) => g.category)).toEqual(['Modos']);
  });

  test('moveCommandPaletteIndex wraps cleanly and handles empty list', () => {
    expect(moveCommandPaletteIndex({ current: 0, total: 0, delta: 1 })).toBe(0);
    expect(moveCommandPaletteIndex({ current: 0, total: 3, delta: -1 })).toBe(2);
    expect(moveCommandPaletteIndex({ current: 2, total: 3, delta: 1 })).toBe(0);
    expect(moveCommandPaletteIndex({ current: 1, total: 3, delta: 1 })).toBe(2);
  });

  test('buildViewerPaletteActions generates toggle and open file actions based on open state', () => {
    const actionsClosed = buildViewerPaletteActions({ open: false, locale: 'pt-BR' });
    expect(actionsClosed).toHaveLength(2);
    expect(actionsClosed[0]?.id).toBe('action:toggle-file-viewer');
    expect(actionsClosed[0]?.title).toBe('Abrir leitor de arquivos');
    expect(actionsClosed[1]?.id).toBe('action:open-file-viewer');
    expect(actionsClosed[1]?.title).toBe('Abrir arquivo no leitor');

    const actionsOpen = buildViewerPaletteActions({ open: true, locale: 'en-US' });
    expect(actionsOpen[0]?.title).toBe('Close file viewer');
    expect(actionsOpen[1]?.title).toBe('Open file in viewer');
  });

  test('buildCommandPaletteItems includes file viewer actions when fileViewer option is provided', () => {
    const items = buildCommandPaletteItems({
      actions: [],
      sessions: [],
      projects: [],
      models: [],
      modes: [],
      fileViewer: { open: false },
    });
    const viewerActions = items.filter(
      (item) => item.id === 'action:toggle-file-viewer' || item.id === 'action:open-file-viewer',
    );
    expect(viewerActions).toHaveLength(2);
    expect(viewerActions[0]?.title).toBe('Abrir leitor de arquivos');
    expect(viewerActions[1]?.title).toBe('Abrir arquivo no leitor');
  });
});
