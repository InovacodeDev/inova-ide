import type { CapabilityAdapter } from './types.js';

export const deepseekCapabilities: CapabilityAdapter = {
  list: () => Promise.resolve({ categories: [], cost: null }),
  launchArgs: () => [],
  setEnabled: () => Promise.reject(new Error('DeepSeek não expõe itens configuráveis.')),
};
