import type { Account, ProviderId } from '../types.js';
import { claudeCapabilities } from './claude.js';
import { codexCapabilities } from './codex.js';
import { deepseekCapabilities } from './deepseek.js';
import { geminiCapabilities } from './gemini.js';
import { grokCapabilities } from './grok.js';
import { kimiCapabilities } from './kimi.js';
import { opencodeCapabilities } from './opencode.js';
import { qwenCapabilities } from './qwen.js';
import { isCapabilityRef } from './types.js';
import type { CapabilityAdapter } from './types.js';

export const capabilityAdapters: Record<ProviderId, CapabilityAdapter> = {
  claude: claudeCapabilities,
  codex: codexCapabilities,
  gemini: geminiCapabilities,
  qwen: qwenCapabilities,
  opencode: opencodeCapabilities,
  deepseek: deepseekCapabilities,
  kimi: kimiCapabilities,
  grok: grokCapabilities,
};

export function capabilityLaunchArgs(
  account: Account,
  extraDisabledSkills?: readonly string[],
): string[] {
  const disabled = (account.disabledCapabilities ?? []).filter(isCapabilityRef);
  if (extraDisabledSkills === undefined || extraDisabledSkills.length === 0) {
    return capabilityAdapters[account.provider].launchArgs(disabled);
  }
  const merged = [...disabled];
  for (const id of extraDisabledSkills) {
    if (!merged.some((ref) => ref.kind === 'skill' && ref.id === id)) {
      merged.push({ kind: 'skill', id });
    }
  }
  return capabilityAdapters[account.provider].launchArgs(merged);
}
