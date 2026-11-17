import { describe, expect, test } from 'vitest';
import { buildPluginInstallRecipe } from './plugins.js';

const BAD_REFERENCES: [string, string][] = [
  ['hífen inicial', '-x'],
  ['espaço', 'a b'],
  ['barra', 'a/b'],
  ['ponto-ponto com barra', '../x'],
  ['ponto inicial', '..'],
  ['ponto e vírgula', ';rm'],
  ['vazio', ''],
  ['101 caracteres', 'a'.repeat(101)],
  ['arroba embutida', 'a@b'],
  ['quebra de linha final', 'abc\n'],
];

describe('revalidação de name e marketplace', () => {
  test.each(BAD_REFERENCES)('name com %s é recusado', (_label, name) => {
    expect(buildPluginInstallRecipe({ provider: 'claude', name }).ok).toBe(false);
  });

  test.each(BAD_REFERENCES)('marketplace com %s é recusado', (_label, marketplace) => {
    expect(buildPluginInstallRecipe({ provider: 'claude', name: 'ok', marketplace }).ok).toBe(
      false,
    );
  });

  test('100 caracteres é aceito', () => {
    expect(buildPluginInstallRecipe({ provider: 'codex', name: 'a'.repeat(100) }).ok).toBe(true);
  });

  test('nome inválido em provider sem suporte continua ok:false', () => {
    expect(buildPluginInstallRecipe({ provider: 'kimi', name: '-x' }).ok).toBe(false);
  });
});

describe('marketplace ausente', () => {
  test('a receita não carrega a chave marketplace', () => {
    const recipe = buildPluginInstallRecipe({ provider: 'gemini', name: 'tool.v2_x' });
    expect(recipe).toEqual({
      ok: true,
      commandId: 'agy.plugin.install',
      params: { name: 'tool.v2_x' },
    });
    if (recipe.ok) expect(Object.keys(recipe.params)).toEqual(['name']);
  });
});
