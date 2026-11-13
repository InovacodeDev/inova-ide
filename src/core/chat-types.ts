import type { ProviderId } from './types.js';

export interface UsageWindow {
  kind: 'session' | 'weekly' | 'monthly';
  usedPercent: number;
  resetsAt: string | null;
  scope?: string;
}

export interface UsageSnapshot {
  provider: ProviderId;
  windows: UsageWindow[];
  source: 'api' | 'stream' | 'rollout' | 'unavailable';
  fetchedAt: string;
}

export interface VerificationCheckResult {
  id: string;
  label: string;
  command: string;
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  output: string;
}

export type SubagentStatus = 'running' | 'done' | 'error';

export interface SubagentSnapshot {
  toolId: string;
  description: string;
  agentType: string | null;
  model: string | null;
  status: SubagentStatus;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type ChatEvent =
  | { kind: 'session'; providerSessionId: string }
  | { kind: 'user'; text: string; at: string }
  | { kind: 'text-delta'; blockId: string; text: string }
  | { kind: 'text'; blockId: string; text: string }
  | { kind: 'tool-use'; toolId: string; name: string; input: string }
  | { kind: 'tool-result'; toolId: string; output: string; isError: boolean }
  | { kind: 'usage-limits'; windows: UsageWindow[] }
  | { kind: 'context'; usedTokens: number; windowTokens: number | null; model: string | null }
  | ({ kind: 'subagent' } & SubagentSnapshot)
  | {
      kind: 'checkpoint';
      turnId: string;
      ref: string;
      createdAt: string;
      skippedLargeFiles: string[];
    }
  | {
      kind: 'verification';
      turnId: string;
      status: 'running' | 'passed' | 'failed' | 'skipped';
      checks: VerificationCheckResult[];
    }
  | { kind: 'error'; message: string }
  | { kind: 'done'; isError: boolean; costUsd: number | null; durationMs: number | null };
