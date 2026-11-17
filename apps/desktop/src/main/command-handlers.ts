import { randomUUID } from 'node:crypto';
import type { Result, RunCommandInput, RunCommandOutcome } from '../shared/api.js';
import { CommandLimitError } from './command-executor.js';
import type { CommandExecutor, ExecRequest } from './command-executor.js';
import type { CommandService } from './command-service.js';
import {
  fail,
  ok,
  parseCommandRunId,
  parseConfirmCommand,
  parseRunCommand,
  validated,
} from './validation.js';

const CONFIRMATION_TTL_MS = 5 * 60_000;
const MAX_PENDING_CONFIRMATIONS = 20;

export interface CommandHandlers {
  runCommand(input: unknown): Promise<Result<RunCommandOutcome>>;
  confirmCommand(input: unknown): Promise<Result<{ runId: string }>>;
  cancelCommand(runId: unknown): void;
}

interface Pending {
  request: ExecRequest;
  expiresAt: number;
}

export function createCommandHandlers(deps: {
  service: Pick<CommandService, 'resolve'>;
  executor: Pick<CommandExecutor, 'run' | 'cancel'>;
}): CommandHandlers {
  const pending = new Map<string, Pending>();

  function prune(now: number): void {
    for (const [id, entry] of pending) {
      if (entry.expiresAt <= now) pending.delete(id);
    }
    while (pending.size >= MAX_PENDING_CONFIRMATIONS) {
      const oldest = pending.keys().next();
      if (oldest.done) return;
      pending.delete(oldest.value);
    }
  }

  async function start(request: ExecRequest): Promise<Result<{ runId: string }>> {
    try {
      const { runId } = await deps.executor.run(request);
      return ok({ runId });
    } catch (error: unknown) {
      if (error instanceof CommandLimitError) {
        return fail('Muitos comandos em andamento. Aguarde ou cancele algum.');
      }
      throw error;
    }
  }

  return {
    runCommand: (input) =>
      validated<RunCommandInput, RunCommandOutcome>(input, parseRunCommand, async (parsed) => {
        const resolved = await deps.service.resolve(parsed);
        if (!resolved.ok) return resolved;
        const request = resolved.value;
        if (!request.mutating) {
          const started = await start(request);
          return started.ok ? ok({ status: 'started', runId: started.value.runId }) : started;
        }
        const now = Date.now();
        prune(now);
        const confirmationId = randomUUID();
        pending.set(confirmationId, { request, expiresAt: now + CONFIRMATION_TTL_MS });
        return ok({
          status: 'needs-confirmation',
          confirmationId,
          argv: [request.binary, ...request.args],
          cwd: request.cwd,
        });
      }),
    confirmCommand: (input) =>
      validated(input, parseConfirmCommand, async ({ confirmationId }) => {
        const entry = pending.get(confirmationId);
        pending.delete(confirmationId);
        if (entry === undefined || entry.expiresAt <= Date.now()) {
          return fail('Confirmação expirada ou inválida.');
        }
        return start(entry.request);
      }),
    cancelCommand(runId) {
      const id = parseCommandRunId(runId);
      if (id !== undefined) deps.executor.cancel(id);
    },
  };
}
