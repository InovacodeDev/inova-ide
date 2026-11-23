import type { ProviderId } from '../types.js';
import { isPluginPackage } from './types.js';
import type { PluginDefinition } from './types.js';

export type PluginCommandId = 'claude.plugin.install' | 'codex.plugin.add' | 'agy.plugin.install';

export type PluginInstallRecipe =
  | { ok: true; commandId: PluginCommandId; params: { name: string; marketplace?: string } }
  | { ok: false; reason: string };

const MAX_REFERENCE_LENGTH = 100;
// REGEX: plugin or marketplace name that starts with an alphanumeric and has no separators
const REFERENCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const COMMAND_BY_PROVIDER: Partial<Record<ProviderId, PluginCommandId>> = {
  claude: 'claude.plugin.install',
  codex: 'codex.plugin.add',
  gemini: 'agy.plugin.install',
};

const UNSUPPORTED_REASON: Partial<Record<ProviderId, string>> = {
  qwen: 'Qwen usa extensões, não plugins.',
  opencode: 'OpenCode não tem instalação de plugin na v1.',
  kimi: 'Kimi não tem instalação de plugin na v1.',
  deepseek: 'DeepSeek não tem instalação de plugin na v1.',
  grok: 'O comando `grok plugin` não foi verificado.',
};

function isPluginReference(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_REFERENCE_LENGTH && REFERENCE_NAME.test(value)
  );
}

export function buildPluginInstallRecipe(def: PluginDefinition): PluginInstallRecipe {
  if (isPluginPackage(def)) {
    return { ok: false, reason: 'Plugin instalado como pacote ZIP na biblioteca da IDE.' };
  }
  const commandId = COMMAND_BY_PROVIDER[def.provider];
  if (commandId === undefined) {
    return {
      ok: false,
      reason: UNSUPPORTED_REASON[def.provider] ?? 'Provider sem suporte a plugin.',
    };
  }
  if (!isPluginReference(def.name)) return { ok: false, reason: 'Nome de plugin inválido.' };
  if (def.marketplace === undefined) return { ok: true, commandId, params: { name: def.name } };
  if (!isPluginReference(def.marketplace)) {
    return { ok: false, reason: 'Marketplace de plugin inválido.' };
  }
  return { ok: true, commandId, params: { name: def.name, marketplace: def.marketplace } };
}
