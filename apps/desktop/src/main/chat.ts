import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { createChatParser } from '@inova/core/chat-events';
import type { ChatParser } from '@inova/core/chat-events';
import type { ChatEvent, UsageWindow } from '@inova/core/chat-types';
import type { LaunchSpec } from '@inova/core/launch';
import type { ProviderId } from '@inova/core/types';

export interface ChildProcessLike {
  pid?: number | undefined;
  stdout: Readable;
  stderr: Readable;
  on(event: 'close' | 'exit', cb: (code: number | null) => void): void;
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

const KILL_AFTER_MS = 2000;
const EXIT_GRACE_MS = 2000;
const STDERR_TAIL_CHARS = 4096;

interface Turn {
  accountId: string;
  pid: number | undefined;
  cancelled: boolean;
  finished: boolean;
  doneSeen: boolean;
  stderrTail: string;
  timer: ReturnType<typeof setTimeout> | undefined;
  exitTimer: ReturnType<typeof setTimeout> | undefined;
  release: () => void;
  settle: () => void;
  exited: Promise<void>;
}

function failureMessage(turn: Turn, code: number | null): string {
  if (turn.cancelled) return 'Turno cancelado.';
  const tail = turn.stderrTail.trim();
  const base = `O processo terminou com código ${code ?? 'desconhecido'}`;
  return tail === '' ? `${base}.` : `${base}: ${tail}`;
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
    if (kind !== 'session' && kind !== 'weekly' && kind !== 'monthly') return undefined;
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

export function createChatRunner(deps: {
  spawnChild: SpawnChild;
  killTree: (pid: number, signal: NodeJS.Signals) => void;
  emit: (sessionId: string, event: ChatEvent) => void;
}): ChatRunner {
  const turns = new Map<string, Turn>();

  function signal(turn: Turn, name: NodeJS.Signals): void {
    if (turn.pid === undefined) return;
    try {
      deps.killTree(turn.pid, name);
    } catch (error: unknown) {
      console.error(`inova: ${name} failed for chat process ${turn.pid}`, error);
    }
  }

  function cancel(sessionId: string): void {
    const turn = turns.get(sessionId);
    if (!turn || turn.cancelled) return;
    turn.cancelled = true;
    turn.timer = setTimeout(() => {
      turn.timer = undefined;
      signal(turn, 'SIGKILL');
      turn.release();
    }, KILL_AFTER_MS);
    signal(turn, 'SIGTERM');
  }

  function finish(input: { sessionId: string; turn: Turn; message: string }): void {
    const { sessionId, turn, message } = input;
    if (turn.finished) return;
    turn.finished = true;
    if (turn.timer !== undefined) clearTimeout(turn.timer);
    if (turn.exitTimer !== undefined) clearTimeout(turn.exitTimer);
    turns.delete(sessionId);
    if (!turn.doneSeen) {
      deps.emit(sessionId, { kind: 'error', message });
      deps.emit(sessionId, { kind: 'done', isError: true, costUsd: null, durationMs: null });
    }
    turn.settle();
  }

  function send(input: {
    sessionId: string;
    accountId: string;
    provider: ProviderId;
    file: string;
    spec: LaunchSpec;
  }): void {
    const { sessionId, spec } = input;
    if (turns.has(sessionId)) throw new ChatBusyError(sessionId);
    let settle: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const turn: Turn = {
      accountId: input.accountId,
      pid: undefined,
      cancelled: false,
      finished: false,
      doneSeen: false,
      stderrTail: '',
      timer: undefined,
      exitTimer: undefined,
      release: () => undefined,
      settle,
      exited,
    };
    turns.set(sessionId, turn);
    let child: ChildProcessLike;
    try {
      child = deps.spawnChild({
        file: input.file,
        args: spec.args,
        cwd: spec.cwd,
        env: spec.env,
      });
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      finish({ sessionId, turn, message: `Falha ao iniciar o processo: ${error.message}` });
      return;
    }
    turn.pid = child.pid;
    const parser: ChatParser = createChatParser(input.provider, { turnId: randomUUID() });
    const decoder = new StringDecoder('utf8');
    let pending = '';

    const handleLine = (line: string): void => {
      for (const event of parser.parse(line)) {
        if (event.kind === 'done') turn.doneSeen = true;
        deps.emit(sessionId, event);
      }
    };
    const consume = (text: string): void => {
      pending += text;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      lines.forEach(handleLine);
    };

    const drainAndFinish = (code: number | null): void => {
      if (turn.finished) return;
      consume(decoder.end());
      if (pending !== '') handleLine(pending);
      pending = '';
      finish({ sessionId, turn, message: failureMessage(turn, code) });
    };
    turn.release = () => {
      drainAndFinish(null);
      child.stdout.destroy();
      child.stderr.destroy();
    };

    child.stdout.on('data', (chunk: Buffer | string) => {
      if (turn.finished) return;
      consume(typeof chunk === 'string' ? chunk : decoder.write(chunk));
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      if (turn.finished) return;
      turn.stderrTail = (turn.stderrTail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
    });
    child.on('error', (error: Error) => {
      finish({ sessionId, turn, message: `Falha ao iniciar o processo: ${error.message}` });
    });
    child.on('exit', (code: number | null) => {
      if (turn.finished) return;
      turn.exitTimer = setTimeout(() => {
        turn.exitTimer = undefined;
        drainAndFinish(code);
        child.stdout.destroy();
        child.stderr.destroy();
      }, EXIT_GRACE_MS);
    });
    child.on('close', drainAndFinish);
  }

  return {
    send,
    cancel,
    isRunning: (sessionId) => turns.has(sessionId),
    accountsInUse: () => new Set([...turns.values()].map((turn) => turn.accountId)),
    async closeAll() {
      const running = [...turns.entries()];
      for (const [sessionId] of running) cancel(sessionId);
      await Promise.all(running.map(([, turn]) => turn.exited));
    },
  };
}
