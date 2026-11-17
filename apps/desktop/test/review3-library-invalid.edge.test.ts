import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import type { InvalidLibraryEntry } from '../src/shared/api';
import { LibrarySection } from '../src/renderer/LibrarySection';
import { translate } from '../src/renderer/i18n';

const state = vi.hoisted(() => ({ invalid: [] as InvalidLibraryEntry[] }));

vi.mock('../src/renderer/useLibrary', () => ({
  libraryCall: vi.fn(),
  useLibrary: () => ({
    listing: { items: [], pluginRecipes: {}, invalidItems: state.invalid },
    loadError: null,
    reload: async () => undefined,
  }),
}));

function render(invalid: InvalidLibraryEntry[]): string {
  state.invalid = invalid;
  return renderToStaticMarkup(
    createElement(LibrarySection, {
      accounts: [],
      projects: [],
      onRun: async () => ({ ok: false as const, message: 'x' }),
    }),
  );
}

describe('LibrarySection mostra os itens com problema', () => {
  test('lista id, motivo e botão Remover dentro de um alerta', () => {
    const html = render([{ id: 'old-one', error: 'definition.args[0] must not contain secrets' }]);
    expect(html).toContain(translate('pt-BR', 'library.invalid.title'));
    expect(html).toContain(translate('pt-BR', 'library.invalid.warning'));
    expect(html).toContain('role="alert"');
    expect(html).toContain('old-one');
    expect(html).toContain('definition.args[0] must not contain secrets');
    expect(html).toContain(translate('pt-BR', 'library.removeAria', { name: 'old-one' }));
  });

  test('não mostra o aviso de biblioteca vazia quando só há inválidos', () => {
    const html = render([{ id: 'old-one', error: 'x' }]);
    expect(html).not.toContain(translate('pt-BR', 'library.empty'));
  });

  test('sem itens inválidos o bloco some e a dica de biblioteca vazia aparece', () => {
    const html = render([]);
    expect(html).not.toContain(translate('pt-BR', 'library.invalid.title'));
    expect(html).toContain(translate('pt-BR', 'library.empty'));
  });
});

describe('textos dos itens com problema existem nos dois idiomas', () => {
  test.each(['library.invalid.title', 'library.invalid.warning'] as const)('%s', (key) => {
    const pt = translate('pt-BR', key);
    const en = translate('en-US', key);
    expect(pt).not.toBe('');
    expect(en).not.toBe('');
    expect(en).not.toBe(pt);
  });
});
