import type { RunCommandOutcome } from '../shared/api';
import type { CommandEvent } from '../shared/command-types';

export type CommandRunStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out' | 'error';

export interface CommandRunView {
  runId: string;
  commandId: string;
  argv: string[];
  cwd: string;
  status: CommandRunStatus;
  output: string;
  exitCode: number | null;
  durationMs: number | null;
  errorMessage: string | null;
}

export interface PendingConfirmation {
  confirmationId: string;
  argv: string[];
  cwd: string;
}

export const MAX_RUNS = 20;
export const MAX_OUTPUT_CHARS = 200_000;

export function isActiveRun(run: CommandRunView): boolean {
  return run.status === 'queued' || run.status === 'running';
}

export function activeRunCount(runs: readonly CommandRunView[]): number {
  return runs.filter(isActiveRun).length;
}

function trim(runs: CommandRunView[]): CommandRunView[] {
  const kept = [...runs];
  for (let index = kept.length - 1; index >= 0 && kept.length > MAX_RUNS; index -= 1) {
    const run = kept[index];
    if (run !== undefined && !isActiveRun(run)) kept.splice(index, 1);
  }
  return kept;
}

function update(
  runs: readonly CommandRunView[],
  runId: string,
  change: (run: CommandRunView) => CommandRunView,
): CommandRunView[] {
  return runs.map((run) => (run.runId === runId ? change(run) : run));
}

function has(runs: readonly CommandRunView[], runId: string): boolean {
  return runs.some((run) => run.runId === runId);
}

function created(
  event: Extract<CommandEvent, { kind: 'queued' | 'start' | 'error' }>,
): CommandRunView {
  const status: CommandRunStatus =
    event.kind === 'queued' ? 'queued' : event.kind === 'start' ? 'running' : 'error';
  return {
    runId: event.runId,
    commandId: event.commandId,
    argv: event.argv,
    cwd: event.kind === 'error' ? '' : event.cwd,
    status,
    output: '',
    exitCode: null,
    durationMs: null,
    errorMessage: event.kind === 'error' ? event.message : null,
  };
}

function exitStatus(event: Extract<CommandEvent, { kind: 'exit' }>): CommandRunStatus {
  if (event.cancelled) return 'cancelled';
  if (event.timedOut) return 'timed-out';
  return event.exitCode === 0 ? 'succeeded' : 'failed';
}

export function applyCommandEvent(
  runs: readonly CommandRunView[],
  event: CommandEvent,
): CommandRunView[] {
  switch (event.kind) {
    case 'queued':
      return has(runs, event.runId) ? [...runs] : trim([created(event), ...runs]);
    case 'start':
      return has(runs, event.runId)
        ? update(runs, event.runId, (run) => ({ ...run, status: 'running' }))
        : trim([created(event), ...runs]);
    case 'error':
      return has(runs, event.runId)
        ? update(runs, event.runId, (run) => ({
            ...run,
            status: 'error',
            errorMessage: event.message,
          }))
        : trim([created(event), ...runs]);
    case 'output':
      return update(runs, event.runId, (run) =>
        isActiveRun(run)
          ? { ...run, output: (run.output + event.text).slice(-MAX_OUTPUT_CHARS) }
          : run,
      );
    case 'exit':
      return update(runs, event.runId, (run) =>
        isActiveRun(run)
          ? {
              ...run,
              status: exitStatus(event),
              exitCode: event.exitCode,
              durationMs: event.durationMs,
            }
          : run,
      );
  }
}

export function formatArgv(argv: readonly string[]): string {
  return argv
    .map((item) =>
      item !== '' && /^[\w@%+=:,./-]+$/.test(item) ? item : `'${item.replace(/'/g, "'\\''")}'`,
    )
    .join(' ');
}

export function pendingFromOutcome(outcome: RunCommandOutcome): PendingConfirmation | null {
  if (outcome.status !== 'needs-confirmation') return null;
  return { confirmationId: outcome.confirmationId, argv: outcome.argv, cwd: outcome.cwd };
}

export function confirmPayload(pending: PendingConfirmation): { confirmationId: string } {
  return { confirmationId: pending.confirmationId };
}
