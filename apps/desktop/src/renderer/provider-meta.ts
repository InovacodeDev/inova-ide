import type { ProviderId } from '@inova/core/types';

export const PROVIDER_NAME: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

export const PROVIDER_LETTER: Record<ProviderId, string> = {
  claude: 'C',
  gemini: 'G',
  codex: 'X',
};
