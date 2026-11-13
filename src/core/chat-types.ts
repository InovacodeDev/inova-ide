import type { ProviderId } from './types.js';

export interface UsageWindow {
  kind: 'session' | 'weekly' | 'monthly';
  usedPercent: number;
  resetsAt: string | null;
}

export interface UsageSnapshot {
  provider: ProviderId;
  windows: UsageWindow[];
  source: 'api' | 'stream' | 'rollout' | 'unavailable';
  fetchedAt: string;
}

export type ChatEvent =
  | { kind: 'session'; providerSessionId: string }
  | { kind: 'user'; text: string; at: string }
  | { kind: 'text-delta'; blockId: string; text: string }
  | { kind: 'text'; blockId: string; text: string }
  | { kind: 'tool-use'; toolId: string; name: string; input: string }
  | { kind: 'tool-result'; toolId: string; output: string; isError: boolean }
  | { kind: 'usage-limits'; windows: UsageWindow[] }
  | { kind: 'error'; message: string }
  | { kind: 'done'; isError: boolean; costUsd: number | null; durationMs: number | null };
