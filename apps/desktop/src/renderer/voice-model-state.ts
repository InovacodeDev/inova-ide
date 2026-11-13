import type { VoiceModelId } from '@inova/core/types';

export type VoiceModelState = 'in-use' | 'installed' | 'missing' | 'downloading';

export function voiceModelState(input: {
  modelId: VoiceModelId;
  activeId: VoiceModelId;
  installed: readonly VoiceModelId[];
  downloading: boolean;
}): VoiceModelState {
  if (input.downloading) return 'downloading';
  if (!input.installed.includes(input.modelId)) return 'missing';
  return input.modelId === input.activeId ? 'in-use' : 'installed';
}

export function downloadPercent(input: { receivedBytes: number; totalBytes: number }): number {
  if (input.totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((input.receivedBytes / input.totalBytes) * 100)));
}
