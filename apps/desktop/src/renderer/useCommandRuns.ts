import { useCallback, useEffect, useState } from 'react';
import type { Result, RunCommandInput, RunCommandOutcome } from '../shared/api';
import { applyCommandEvent, confirmPayload, pendingFromOutcome } from './command-runs-state';
import type { CommandRunView, PendingConfirmation } from './command-runs-state';

export interface CommandRuns {
  runs: CommandRunView[];
  pending: PendingConfirmation | null;
  requestRun: (input: RunCommandInput) => Promise<Result<RunCommandOutcome>>;
  confirmPending: () => Promise<Result<{ runId: string }> | null>;
  dismissPending: () => void;
  cancelRun: (runId: string) => void;
}

export function useCommandRuns(): CommandRuns {
  const [runs, setRuns] = useState<CommandRunView[]>([]);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);

  useEffect(
    () =>
      window.inova.onCommandEvent((event) =>
        setRuns((current) => applyCommandEvent(current, event)),
      ),
    [],
  );

  const requestRun = useCallback(async (input: RunCommandInput) => {
    const result = await window.inova.runCommand(input);
    if (result.ok) setPending(pendingFromOutcome(result.value));
    return result;
  }, []);

  const confirmPending = useCallback(async () => {
    if (pending === null) return null;
    setPending(null);
    return window.inova.confirmCommand(confirmPayload(pending));
  }, [pending]);

  const dismissPending = useCallback(() => setPending(null), []);
  const cancelRun = useCallback((runId: string) => window.inova.cancelCommand(runId), []);

  return { runs, pending, requestRun, confirmPending, dismissPending, cancelRun };
}
