import { describe, expect, test } from 'vitest';
import {
  activeRunCount,
  applyCommandEvent,
  confirmPayload,
  formatArgv,
  pendingFromOutcome,
} from '../src/renderer/command-runs-state';
import type { CommandRunView } from '../src/renderer/command-runs-state';
import type { CommandEvent } from '../src/shared/command-types';

const queued: CommandEvent = {
  kind: 'queued',
  runId: 'r1',
  commandId: 'gh.extension.upgrade',
  argv: ['gh', 'extension', 'upgrade', 'owner/gh-foo'],
  cwd: '/home/user',
};

function replay(events: readonly CommandEvent[]): CommandRunView[] {
  return events.reduce<CommandRunView[]>((runs, event) => applyCommandEvent(runs, event), []);
}

describe('regra 5: confirmação mostra o argv final e roda só ele', () => {
  const outcome = {
    status: 'needs-confirmation' as const,
    confirmationId: 'conf-1',
    argv: ['gh', 'extension', 'upgrade', 'owner/gh-foo'],
    cwd: '/home/user',
  };

  test('o pedido pendente carrega o argv exato devolvido pelo main', () => {
    expect(pendingFromOutcome(outcome)).toEqual({
      confirmationId: 'conf-1',
      argv: ['gh', 'extension', 'upgrade', 'owner/gh-foo'],
      cwd: '/home/user',
    });
  });

  test('um comando já iniciado não abre confirmação', () => {
    expect(pendingFromOutcome({ status: 'started', runId: 'r1' })).toBeNull();
  });

  test('o texto mostrado ao usuário é o argv completo, sem omitir nem alterar argumentos', () => {
    expect(formatArgv(outcome.argv)).toBe('gh extension upgrade owner/gh-foo');
    expect(formatArgv(['gh', 'a b', "it's", ''])).toBe(`gh 'a b' 'it'\\''s' ''`);
  });

  test('confirmar envia só o id da confirmação, nunca argv ou commandId', () => {
    const pending = pendingFromOutcome(outcome);
    if (pending === null) throw new Error('sem pendência');
    expect(confirmPayload(pending)).toEqual({ confirmationId: 'conf-1' });
  });
});

describe('lista de execuções (somente leitura)', () => {
  test('uma execução completa passa por queued, running e succeeded', () => {
    const runs = replay([
      queued,
      {
        kind: 'start',
        runId: 'r1',
        commandId: queued.commandId,
        argv: queued.argv,
        cwd: '/home/user',
      },
      { kind: 'output', runId: 'r1', stream: 'stdout', text: 'ok\n' },
      {
        kind: 'exit',
        runId: 'r1',
        exitCode: 0,
        durationMs: 1200,
        truncated: false,
        timedOut: false,
        cancelled: false,
      },
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'succeeded',
      output: 'ok\n',
      exitCode: 0,
      durationMs: 1200,
    });
    expect(activeRunCount(runs)).toBe(0);
  });

  test('execução ativa conta no indicador', () => {
    expect(activeRunCount(replay([queued]))).toBe(1);
  });

  test('cancelamento e timeout têm estados próprios', () => {
    const base = { kind: 'exit', exitCode: null, durationMs: 5, truncated: false } as const;
    const cancelled = replay([queued, { ...base, runId: 'r1', timedOut: false, cancelled: true }]);
    const timedOut = replay([queued, { ...base, runId: 'r1', timedOut: true, cancelled: false }]);
    expect(cancelled[0]?.status).toBe('cancelled');
    expect(timedOut[0]?.status).toBe('timed-out');
  });
});
