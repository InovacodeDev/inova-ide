import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { maskSecretsInText } from '@inova/core/profile-sync';
import { TRUNCATION_MARKER } from '../shared/command-types.js';
import type { CommandErrorCode, CommandEvent, CommandStream } from '../shared/command-types.js';
import type { ChildProcessLike, SpawnChild } from './chat.js';
import { stripAnsi } from './login-flow.js';

export interface ExecRequest {
  commandId: string;
  binary: string;
  args: string[];
  cwd: string;
  mutating: boolean;
  queueKey: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

export interface CommandExecutor {
  run(request: ExecRequest): Promise<{ runId: string }>;
  cancel(runId: string): void;
  onEvent(listener: (event: CommandEvent) => void): () => void;
  closeAll(): Promise<void>;
}

export interface CommandExecutorDeps {
  spawnChild: SpawnChild;
  killTree: (pid: number, signal: NodeJS.Signals) => void;
  env: () => Promise<NodeJS.ProcessEnv>;
  findBinary: (name: string, env: NodeJS.ProcessEnv) => Promise<string | undefined>;
}

const KILL_AFTER_MS = 2000;
const EXIT_GRACE_MS = 2000;
const MAX_PENDING_CHARS = 4096;
const EXEC_ENV: NodeJS.ProcessEnv = {
  NO_COLOR: '1',
  GH_PROMPT_DISABLED: '1',
  GIT_TERMINAL_PROMPT: '0',
};
// REGEX: well-known token shapes (GitHub, OpenAI-style, Slack, AWS access key id)
const TOKEN_SHAPE =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g;
// REGEX: unquoted secret assignment such as GH_TOKEN=value or api_key: value
const SECRET_ASSIGNMENT =
  /(\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY)\s*[=:]\s*)\S+/gi;
// REGEX: Authorization header with a non-Bearer scheme
const AUTH_HEADER = /(Authorization:\s*(?:token|basic)\s+)\S+/gi;

export function sanitizeOutput(text: string): string {
  return maskSecretsInText(stripAnsi(text))
    .replace(AUTH_HEADER, '$1***')
    .replace(SECRET_ASSIGNMENT, '$1***')
    .replace(TOKEN_SHAPE, '***');
}

interface LineSink {
  decoder: StringDecoder;
  pending: string;
}

type RunState = 'queued' | 'starting' | 'running';

interface Run {
  id: string;
  request: ExecRequest;
  argv: string[];
  state: RunState;
  cancelled: boolean;
  timedOut: boolean;
  truncated: boolean;
  finished: boolean;
  emittedBytes: number;
  pid: number | undefined;
  startedAt: number;
  child: ChildProcessLike | undefined;
  timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  killTimer: ReturnType<typeof setTimeout> | undefined;
  exitTimer: ReturnType<typeof setTimeout> | undefined;
  sinks: Record<CommandStream, LineSink>;
  onAbort: (() => void) | undefined;
  settle: () => void;
  exited: Promise<void>;
}

interface Slot {
  active: Run | undefined;
  waiting: Run[];
}

function newSink(): LineSink {
  return { decoder: new StringDecoder('utf8'), pending: '' };
}

function cutToBytes(text: string, bytes: number): string {
  return Buffer.from(text, 'utf8').subarray(0, bytes).toString('utf8').replace(/�+$/, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingBinary(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function createCommandExecutor(deps: CommandExecutorDeps): CommandExecutor {
  const runs = new Map<string, Run>();
  const slots = new Map<string, Slot>();
  const listeners = new Set<(event: CommandEvent) => void>();

  function emit(event: CommandEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        console.error('inova: command event listener failed', error);
      }
    }
  }

  function signal(run: Run, name: NodeJS.Signals): void {
    if (run.pid === undefined) return;
    try {
      deps.killTree(run.pid, name);
    } catch (error: unknown) {
      console.error(`inova: ${name} failed for command process ${run.pid}`, error);
    }
  }

  function releaseSlot(run: Run): void {
    if (!run.request.mutating) return;
    const key = run.request.queueKey;
    const slot = slots.get(key);
    if (slot?.active !== run) return;
    const next = slot.waiting.shift();
    slot.active = next;
    if (next === undefined) {
      slots.delete(key);
      return;
    }
    void execute(next);
  }

  function settleRun(run: Run): void {
    run.finished = true;
    if (run.timeoutTimer !== undefined) clearTimeout(run.timeoutTimer);
    if (run.killTimer !== undefined) clearTimeout(run.killTimer);
    if (run.exitTimer !== undefined) clearTimeout(run.exitTimer);
    if (run.onAbort !== undefined) run.request.signal?.removeEventListener('abort', run.onAbort);
    runs.delete(run.id);
    releaseSlot(run);
    run.settle();
  }

  function emitOutput(run: Run, stream: CommandStream, text: string): void {
    emit({ kind: 'output', runId: run.id, stream, text });
  }

  function emitLine(run: Run, stream: CommandStream, line: string): void {
    if (run.truncated) return;
    const text = `${sanitizeOutput(line)}\n`;
    const bytes = Buffer.byteLength(text, 'utf8');
    const remaining = run.request.maxOutputBytes - run.emittedBytes;
    if (bytes <= remaining) {
      run.emittedBytes += bytes;
      emitOutput(run, stream, text);
      return;
    }
    run.truncated = true;
    const head = remaining > 0 ? cutToBytes(text, remaining) : '';
    run.emittedBytes = run.request.maxOutputBytes;
    if (head !== '') emitOutput(run, stream, head);
    emitOutput(run, stream, `\n${TRUNCATION_MARKER}\n`);
  }

  function consume(run: Run, stream: CommandStream, chunk: Buffer | string): void {
    if (run.finished) return;
    const sink = run.sinks[stream];
    const decoded = typeof chunk === 'string' ? chunk : sink.decoder.write(chunk);
    sink.pending += decoded.replace(/\r\n?/g, '\n');
    const lines = sink.pending.split('\n');
    sink.pending = lines.pop() ?? '';
    for (const line of lines) emitLine(run, stream, line);
    // NOTE: a line longer than MAX_PENDING_CHARS is flushed in pieces; a secret split exactly on a piece boundary is not masked
    while (sink.pending.length > MAX_PENDING_CHARS) {
      emitLine(run, stream, sink.pending.slice(0, MAX_PENDING_CHARS));
      sink.pending = sink.pending.slice(MAX_PENDING_CHARS);
    }
  }

  function flush(run: Run): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      const sink = run.sinks[stream];
      const rest = sink.pending + sink.decoder.end();
      sink.pending = '';
      if (rest !== '') emitLine(run, stream, rest);
    }
  }

  function complete(run: Run, exitCode: number | null): void {
    if (run.finished) return;
    flush(run);
    const durationMs = run.state === 'running' ? Date.now() - run.startedAt : 0;
    emit({
      kind: 'exit',
      runId: run.id,
      exitCode,
      durationMs,
      truncated: run.truncated,
      timedOut: run.timedOut,
      cancelled: run.cancelled,
    });
    settleRun(run);
  }

  function fail(run: Run, code: CommandErrorCode, message: string): void {
    if (run.finished) return;
    emit({ kind: 'error', runId: run.id, code, binary: run.request.binary, message });
    settleRun(run);
  }

  function destroyStreams(run: Run): void {
    run.child?.stdout.destroy();
    run.child?.stderr.destroy();
  }

  function terminate(run: Run): void {
    if (run.killTimer !== undefined) return;
    run.killTimer = setTimeout(() => {
      run.killTimer = undefined;
      signal(run, 'SIGKILL');
      complete(run, null);
      destroyStreams(run);
    }, KILL_AFTER_MS);
    signal(run, 'SIGTERM');
  }

  function spawnRun(run: Run, file: string, env: NodeJS.ProcessEnv): void {
    let child: ChildProcessLike;
    try {
      child = deps.spawnChild({
        file,
        args: run.request.args,
        cwd: run.request.cwd,
        env: { ...env, ...EXEC_ENV },
      });
    } catch (error: unknown) {
      fail(run, 'spawn-failed', errorMessage(error));
      return;
    }
    run.child = child;
    run.pid = child.pid;
    run.state = 'running';
    run.startedAt = Date.now();
    emit({
      kind: 'start',
      runId: run.id,
      commandId: run.request.commandId,
      argv: run.argv,
      cwd: run.request.cwd,
    });
    run.timeoutTimer = setTimeout(() => {
      run.timeoutTimer = undefined;
      run.timedOut = true;
      terminate(run);
    }, run.request.timeoutMs);
    child.stdout.on('data', (chunk: Buffer | string) => consume(run, 'stdout', chunk));
    child.stderr.on('data', (chunk: Buffer | string) => consume(run, 'stderr', chunk));
    child.on('error', (error: Error) => {
      if (child.pid !== undefined) {
        console.error('inova: command child error', error);
        return;
      }
      fail(run, isMissingBinary(error) ? 'binary-not-found' : 'spawn-failed', error.message);
    });
    child.on('exit', (code: number | null) => {
      if (run.finished) return;
      run.exitTimer = setTimeout(() => {
        run.exitTimer = undefined;
        complete(run, code);
        destroyStreams(run);
      }, EXIT_GRACE_MS);
    });
    child.on('close', (code: number | null) => complete(run, code));
  }

  async function execute(run: Run): Promise<void> {
    run.state = 'starting';
    try {
      const env = await deps.env();
      const file = await deps.findBinary(run.request.binary, env);
      if (run.finished) return;
      if (run.cancelled) {
        complete(run, null);
        return;
      }
      if (file === undefined) {
        fail(run, 'binary-not-found', `Binário não encontrado: ${run.request.binary}.`);
        return;
      }
      spawnRun(run, file, env);
    } catch (error: unknown) {
      fail(run, 'spawn-failed', errorMessage(error));
    }
  }

  function admit(run: Run): void {
    if (!run.request.mutating) {
      void execute(run);
      return;
    }
    const key = run.request.queueKey;
    const slot = slots.get(key) ?? { active: undefined, waiting: [] };
    slots.set(key, slot);
    if (slot.active === undefined) {
      slot.active = run;
      void execute(run);
      return;
    }
    slot.waiting.push(run);
    emit({
      kind: 'queued',
      runId: run.id,
      commandId: run.request.commandId,
      argv: run.argv,
      cwd: run.request.cwd,
    });
  }

  function cancel(runId: string): void {
    const run = runs.get(runId);
    if (run === undefined || run.finished || run.cancelled) return;
    run.cancelled = true;
    if (run.state === 'queued') {
      const slot = slots.get(run.request.queueKey);
      if (slot) slot.waiting = slot.waiting.filter((waiting) => waiting !== run);
      complete(run, null);
      return;
    }
    if (run.state === 'running') terminate(run);
  }

  return {
    async run(request) {
      const id = randomUUID();
      let settle: () => void = () => undefined;
      const exited = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const run: Run = {
        id,
        request,
        argv: [request.binary, ...request.args],
        state: 'queued',
        cancelled: false,
        timedOut: false,
        truncated: false,
        finished: false,
        emittedBytes: 0,
        pid: undefined,
        startedAt: 0,
        child: undefined,
        timeoutTimer: undefined,
        killTimer: undefined,
        exitTimer: undefined,
        sinks: { stdout: newSink(), stderr: newSink() },
        onAbort: undefined,
        settle,
        exited,
      };
      runs.set(id, run);
      if (request.signal !== undefined) {
        run.onAbort = () => cancel(id);
        request.signal.addEventListener('abort', run.onAbort, { once: true });
        if (request.signal.aborted) run.cancelled = true;
      }
      if (run.cancelled) {
        complete(run, null);
        return { runId: id };
      }
      admit(run);
      return { runId: id };
    },
    cancel,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async closeAll() {
      const active = [...runs.values()];
      for (const run of active) cancel(run.id);
      await Promise.all(active.map((run) => run.exited));
    },
  };
}
