import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import type { LibraryItem, ProjectView } from '../src/shared/api';
import { LibraryItemRow } from '../src/renderer/LibraryItemRow';
import { ProjectLibraryPanel } from '../src/renderer/ProjectLibraryPanel';
import { translate } from '../src/renderer/i18n';

const listing = vi.hoisted(() => ({ items: [] as LibraryItem[] }));

vi.mock('../src/renderer/useLibrary', () => ({
  libraryCall: vi.fn(),
  useLibrary: () => ({
    listing: { items: listing.items, pluginRecipes: {} },
    loadError: null,
    reload: async () => undefined,
  }),
}));

const NOW = '2026-11-17T10:00:00.000Z';

function pluginItem(enabled: boolean): LibraryItem {
  return {
    id: 'plugin-a',
    kind: 'plugin',
    name: 'Plugin A',
    description: null,
    enabled,
    source: 'created',
    definition: { provider: 'claude', name: 'plugin-a', marketplace: 'market' },
    updatedAt: NOW,
  };
}

function skillItem(): LibraryItem {
  return {
    id: 'skill-a',
    kind: 'skill',
    name: 'Skill A',
    description: null,
    enabled: true,
    source: 'created',
    definition: { hash: 'abc' },
    updatedAt: NOW,
  };
}

function renderRow(item: LibraryItem): string {
  return renderToStaticMarkup(
    createElement(LibraryItemRow, {
      item,
      recipe: undefined,
      accounts: [],
      pending: false,
      onToggle: () => undefined,
      onEdit: () => undefined,
      onRemove: () => undefined,
      onRun: async () => ({ ok: false as const, message: 'x' }),
    }),
  );
}

function renderPanel(items: LibraryItem[]): string {
  listing.items = items;
  const project: ProjectView = {
    id: 'p1',
    path: '/p',
    accountLabel: 'a',
    accountEmail: null,
    provider: 'claude',
  };
  return renderToStaticMarkup(
    createElement(ProjectLibraryPanel, { project, onDisabledChange: () => undefined }),
  );
}

describe('plugin desligado na biblioteca não oferece instalar', () => {
  test('plugin ligado mostra o botão de instalar', () => {
    expect(renderRow(pluginItem(true))).toContain(translate('pt-BR', 'library.plugin.install'));
  });

  test('plugin desligado omite o botão e mostra a dica', () => {
    const html = renderRow(pluginItem(false));
    expect(html).not.toContain(translate('pt-BR', 'library.plugin.install'));
    expect(html).toContain(translate('pt-BR', 'library.plugin.disabled'));
  });
});

describe('painel por projeto explica o limite da skill', () => {
  test('skill mostra a nota e plugin não', () => {
    const note = translate('pt-BR', 'library.project.skillNote');
    expect(renderPanel([skillItem()])).toContain(note);
    expect(renderPanel([pluginItem(true)])).not.toContain(note);
  });

  test('a nota existe em en-US', () => {
    expect(translate('en-US', 'library.project.skillNote')).not.toBe(
      translate('pt-BR', 'library.project.skillNote'),
    );
  });
});
