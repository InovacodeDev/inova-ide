import { randomUUID } from 'node:crypto';
import type { LaunchSpec } from '@inova/core/launch';

export interface PtyProcess {
  pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

export type SpawnPty = (input: {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols: number;
  rows: number;
}) => PtyProcess;

export interface SessionEvents {
  data(sessionId: string, data: string): void;
  exit(sessionId: string, exitCode: number): void;
}

export interface SessionManager {
  open(input: {
    spec: LaunchSpec;
    file: string;
    accountId: string;
    cols: number;
    rows: number;
  }): string;
  write(sessionId: string, data: string): void;
  resize(input: { sessionId: string; cols: number; rows: number }): void;
  close(sessionId: string): void;
  closeAll(): Promise<void>;
  accountsInUse(): ReadonlySet<string>;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_SIZE = 500;
const KILL_AFTER_MS = 2000;

interface Closing {
  timer: ReturnType<typeof setTimeout>;
  settle: () => void;
  done: Promise<void>;
}

function clampAxis(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.round(value), MAX_SIZE);
}

export function clampSize(cols: number, rows: number): { cols: number; rows: number } {
  return { cols: clampAxis(cols, DEFAULT_COLS), rows: clampAxis(rows, DEFAULT_ROWS) };
}

export function createSessionManager(deps: {
  spawnPty: SpawnPty;
  events: SessionEvents;
  killTree: (pid: number, signal: NodeJS.Signals) => void;
}): SessionManager {
  const sessions = new Map<string, { pty: PtyProcess; accountId: string }>();
  const closing = new Map<string, Closing>();

  function settleClosing(sessionId: string): void {
    const entry = closing.get(sessionId);
    if (!entry) return;
    clearTimeout(entry.timer);
    closing.delete(sessionId);
    entry.settle();
  }

  function close(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    const { pid } = session.pty;
    let settle: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const timer = setTimeout(() => {
      closing.delete(sessionId);
      try {
        deps.killTree(pid, 'SIGKILL');
      } finally {
        settle();
      }
    }, KILL_AFTER_MS);
    closing.set(sessionId, { timer, settle, done });
    deps.killTree(pid, 'SIGHUP');
  }

  return {
    close,
    open({ spec, file, accountId, cols, rows }) {
      const sessionId = randomUUID();
      const pty = deps.spawnPty({
        file,
        args: spec.args,
        cwd: spec.cwd,
        env: spec.env,
        ...clampSize(cols, rows),
      });
      sessions.set(sessionId, { pty, accountId });
      pty.onData((data) => deps.events.data(sessionId, data));
      pty.onExit(({ exitCode }) => {
        sessions.delete(sessionId);
        settleClosing(sessionId);
        deps.events.exit(sessionId, exitCode);
      });
      return sessionId;
    },
    write(sessionId, data) {
      sessions.get(sessionId)?.pty.write(data);
    },
    resize({ sessionId, cols, rows }) {
      const size = clampSize(cols, rows);
      sessions.get(sessionId)?.pty.resize(size.cols, size.rows);
    },
    async closeAll() {
      for (const sessionId of [...sessions.keys()]) close(sessionId);
      await Promise.all([...closing.values()].map((entry) => entry.done));
    },
    accountsInUse() {
      return new Set([...sessions.values()].map((session) => session.accountId));
    },
  };
}
