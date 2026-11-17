export type CommandStream = 'stdout' | 'stderr';

export type CommandErrorCode = 'binary-not-found' | 'spawn-failed' | 'pty-unavailable';

export type CommandEvent =
  | { kind: 'queued'; runId: string; commandId: string; argv: string[]; cwd: string }
  | { kind: 'start'; runId: string; commandId: string; argv: string[]; cwd: string }
  | { kind: 'output'; runId: string; stream: CommandStream; text: string }
  | {
      kind: 'exit';
      runId: string;
      exitCode: number | null;
      durationMs: number;
      truncated: boolean;
      timedOut: boolean;
      cancelled: boolean;
    }
  | {
      kind: 'error';
      runId: string;
      commandId: string;
      argv: string[];
      code: CommandErrorCode;
      binary: string;
      message: string;
    };

export const TRUNCATION_MARKER = '[saída cortada]';
