import { describe, expect, test } from 'vitest';
import type { ProviderId } from '../types.js';
import { buildPluginInstallRecipe } from './plugins.js';

describe('regra 7: provider sem suporte a plugin recebe unsupported com motivo', () => {
  test.each([
    ['claude', 'claude.plugin.install'],
    ['codex', 'codex.plugin.add'],
    ['gemini', 'agy.plugin.install'],
  ] as const)('%s monta a receita %s', (provider, commandId) => {
    expect(
      buildPluginInstallRecipe({ provider, marketplace: 'official', name: 'code-simplifier' }),
    ).toEqual({
      ok: true,
      commandId,
      params: { name: 'code-simplifier', marketplace: 'official' },
    });
  });

  test.each(['qwen', 'opencode', 'kimi', 'deepseek', 'grok'] as const satisfies ProviderId[])(
    '%s devolve ok:false com motivo',
    (provider) => {
      const recipe = buildPluginInstallRecipe({ provider, name: 'code-simplifier' });
      expect(recipe.ok).toBe(false);
      if (!recipe.ok) expect(recipe.reason.length).toBeGreaterThan(0);
    },
  );

  test('o motivo de qwen cita extensões', () => {
    const recipe = buildPluginInstallRecipe({ provider: 'qwen', name: 'x' });
    expect(recipe).toMatchObject({ ok: false, reason: expect.stringContaining('extensões') });
  });
});
