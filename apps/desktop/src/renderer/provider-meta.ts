import type { ProviderId } from '@inova/core/types';

export const PROVIDER_NAME: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  grok: 'Grok',
  qwen: 'Qwen',
  opencode: 'OpenCode',
};

export const PROVIDER_BINARY: Record<ProviderId, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'agy',
  deepseek: 'dsh',
  kimi: 'kimi',
  grok: 'grok',
  qwen: 'qwen',
  opencode: 'opencode',
};

export function accountDisplayName(input: { label: string; email?: string | null }): string {
  const email = input.email?.trim();
  return email && email !== '' ? email : input.label;
}
