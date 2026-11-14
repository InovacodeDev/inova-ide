import { describe, expect, it } from 'vitest';
import { nativeSlashCommands } from './slash-commands.js';
import type { ProviderId } from './types.js';

const PROVIDERS: readonly ProviderId[] = [
  'claude',
  'codex',
  'gemini',
  'deepseek',
  'kimi',
  'grok',
  'qwen',
  'opencode',
];

describe('nativeSlashCommands', () => {
  it('não expõe /clear para gemini', () => {
    const names = nativeSlashCommands('gemini').map((command) => command.name);

    expect(names).not.toContain('clear');
  });

  it('expõe /compact como passthrough e /clear como clear para claude', () => {
    const commands = nativeSlashCommands('claude');

    expect(commands).toContainEqual({
      name: 'compact',
      description: 'Resume a conversa para liberar contexto',
      action: 'passthrough',
    });
    expect(commands).toContainEqual({
      name: 'clear',
      description: 'Limpa a conversa e a memória do agente',
      action: 'clear',
    });
  });

  it('expõe /new como clear para codex', () => {
    expect(nativeSlashCommands('codex')).toContainEqual({
      name: 'new',
      description: 'Inicia uma conversa nova',
      action: 'clear',
    });
  });

  it('expõe /model ou /models como model-picker em todo provider', () => {
    for (const provider of PROVIDERS) {
      const hasModelPicker = nativeSlashCommands(provider).some(
        (command) =>
          (command.name === 'model' || command.name === 'models') &&
          command.action === 'model-picker',
      );

      expect(hasModelPicker, provider).toBe(true);
    }
  });

  it('usa nomes sem barra e únicos em cada provider', () => {
    for (const provider of PROVIDERS) {
      const names = nativeSlashCommands(provider).map((command) => command.name);

      for (const name of names) {
        expect(name, provider).not.toContain('/');
      }
      expect(new Set(names).size, provider).toBe(names.length);
    }
  });
});
