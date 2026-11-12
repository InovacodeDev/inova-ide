import { StringDecoder } from 'node:string_decoder';
import { createChatParser } from '@inova/core/chat-events';
import type { ChatParser } from '@inova/core/chat-events';
import type { ChatEvent, UsageWindow } from '@inova/core/chat-types';
import type { LaunchSpec } from '@inova/core/launch';
import type { ProviderId } from '@inova/core/types';

export interface ChildProcessLike {
  pid?: number | undefined;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on(event: 'close', cb: (code: number | null) => void): void;
  on(event: 'error', cb: (error: Error) => void): void;
}

export type SpawnChild = (input: {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => ChildProcessLike;

export interface ChatRunner {
  send(input: {
    sessionId: string;
    accountId: string;
    provider: ProviderId;
    file: string;
    spec: LaunchSpec;
  }): void;
  cancel(sessionId: string): void;
  isRunning(sessionId: string): boolean;
  accountsInUse(): ReadonlySet<string>;
  closeAll(): Promise<void>;
}

export class ChatBusyError extends Error {
  constructor(sessionId: string) {
    super(`A chat turn is already running for session ${sessionId}`);
    this.name = 'ChatBusyError';
  }
}

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(record: Json, keys: readonly string[]): boolean {
  return keys.every((key) => typeof record[key] === 'string');
}

function numberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function windowsOf(value: unknown): UsageWindow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const windows: UsageWindow[] = [];
  for (const item of value as unknown[]) {
    if (!isJson(item)) return undefined;
    const { kind, usedPercent, resetsAt } = item;
    if (kind !== 'session' && kind !== 'weekly') return undefined;
    if (typeof usedPercent !== 'number') return undefined;
    if (resetsAt !== null && typeof resetsAt !== 'string') return undefined;
    windows.push({ kind, usedPercent, resetsAt });
  }
  return windows;
}

function eventOf(record: Json): ChatEvent | undefined {
  switch (record['kind']) {
    case 'session':
      return strings(record, ['providerSessionId'])
        ? { kind: 'session', providerSessionId: String(record['providerSessionId']) }
        : undefined;
    case 'user':
      return strings(record, ['text', 'at'])
        ? { kind: 'user', text: String(record['text']), at: String(record['at']) }
        : undefined;
    case 'text':
      return strings(record, ['blockId', 'text'])
        ? { kind: 'text', blockId: String(record['blockId']), text: String(record['text']) }
        : undefined;
    case 'tool-use':
      return strings(record, ['toolId', 'name', 'input'])
        ? {
            kind: 'tool-use',
            toolId: String(record['toolId']),
            name: String(record['name']),
            input: String(record['input']),
          }
        : undefined;
    case 'tool-result':
      return strings(record, ['toolId', 'output']) && typeof record['isError'] === 'boolean'
        ? {
            kind: 'tool-result',
            toolId: String(record['toolId']),
            output: String(record['output']),
            isError: record['isError'],
          }
        : undefined;
    case 'usage-limits': {
      const windows = windowsOf(record['windows']);
      return windows && { kind: 'usage-limits', windows };
    }
    case 'error':
      return strings(record, ['message'])
        ? { kind: 'error', message: String(record['message']) }
        : undefined;
    case 'done': {
      const { isError, costUsd, durationMs } = record;
      return typeof isError === 'boolean' && numberOrNull(costUsd) && numberOrNull(durationMs)
        ? { kind: 'done', isError, costUsd, durationMs }
        : undefined;
    }
    default:
      return undefined;
  }
}

export function parseTranscriptLine(line: string): ChatEvent | undefined {
  if (line.trim() === '') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  return isJson(value) ? eventOf(value) : undefined;
}

