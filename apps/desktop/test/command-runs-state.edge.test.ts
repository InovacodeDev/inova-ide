import { describe, expect, test } from 'vitest';
import { MAX_OUTPUT_CHARS, MAX_RUNS, applyCommandEvent } from '../src/renderer/command-runs-state';
import type { CommandRunView } from '../src/renderer/command-runs-state';
import type { CommandEvent } from '../src/shared/command-types';

const start = (runId: string): CommandEvent => ({
  kind: 'start',
  runId,
  commandId: 'gh.version',
  argv: ['gh', '--version'],
  cwd: '/n',
});
const exit = (runId: string, exitCode: number | null = 0): CommandEvent => ({
  kind: 'exit',
  runId,
  exitCode,
  durationMs: 1,
  truncated: false,
  timedOut: false,
  cancelled: false,
});

function replay(events: readonly CommandEvent[]): CommandRunView[] {
  return events.reduce<CommandRunView[]>((runs, event) => applyCommandEvent(runs, event), []);
}

describe('eventos fora de ordem ou hostis', () => {
  test('output e exit de uma execução desconhecida são ignorados', () => {
    const runs = replay([{ kind: 'output', runId: 'x', stream: 'stdout', text: 'a' }, exit('x')]);
    expect(runs).toEqual([]);
  });

  test('output depois do exit é ignorado', () => {
    const runs = replay([
      start('r1'),
      exit('r1'),
      { kind: 'output', runId: 'r1', stream: 'stdout', text: 'tarde' },
    ]);
    expect(runs[0]?.output).toBe('');
  });

  test('um segundo exit não sobrescreve o primeiro', () => {
    const runs = replay([start('r1'), exit('r1', 0), exit('r1', 1)]);
    expect(runs[0]).toMatchObject({ status: 'succeeded', exitCode: 0 });
  });

  test('exit com código diferente de zero é falha', () => {
    expect(replay([start('r1'), exit('r1', 2)])[0]?.status).toBe('failed');
    expect(replay([start('r1'), exit('r1', null)])[0]?.status).toBe('failed');
  });

  test('queued duplicado não cria outra linha', () => {
    const queued: CommandEvent = {
      kind: 'queued',
      runId: 'r1',
      commandId: 'a.b',
      argv: ['a'],
      cwd: '/n',
    };
    expect(replay([queued, queued])).toHaveLength(1);
  });
});

describe('erro de execução', () => {
  test('error sem start cria a linha com argv e mensagem', () => {
    const runs = replay([
      {
        kind: 'error',
        runId: 'r1',
        commandId: 'gh.version',
        argv: ['gh', '--version'],
        code: 'binary-not-found',
        binary: 'gh',
        message: 'Binário não encontrado: gh.',
      },
    ]);
    expect(runs[0]).toMatchObject({
      status: 'error',
      argv: ['gh', '--version'],
      errorMessage: 'Binário não encontrado: gh.',
    });
  });
});

describe('limites', () => {
  test('mantém no máximo MAX_RUNS execuções, descartando as terminadas mais antigas', () => {
    const events: CommandEvent[] = [];
    for (let index = 0; index < MAX_RUNS + 5; index += 1) {
      events.push(start(`r${index}`), exit(`r${index}`));
    }
    const runs = replay(events);
    expect(runs).toHaveLength(MAX_RUNS);
    expect(runs[0]?.runId).toBe(`r${MAX_RUNS + 4}`);
    expect(runs.some((run) => run.runId === 'r0')).toBe(false);
  });

  test('nunca descarta uma execução ativa', () => {
    const events: CommandEvent[] = [start('ativa')];
    for (let index = 0; index < MAX_RUNS + 5; index += 1) {
      events.push(start(`r${index}`), exit(`r${index}`));
    }
    expect(replay(events).some((run) => run.runId === 'ativa')).toBe(true);
  });

  test('a saída acumulada fica limitada, mantendo o fim', () => {
    const runs = replay([
      start('r1'),
      { kind: 'output', runId: 'r1', stream: 'stdout', text: 'a'.repeat(MAX_OUTPUT_CHARS) },
      { kind: 'output', runId: 'r1', stream: 'stdout', text: 'FIM' },
    ]);
    expect(runs[0]?.output).toHaveLength(MAX_OUTPUT_CHARS);
    expect(runs[0]?.output.endsWith('FIM')).toBe(true);
  });

  test('não altera o array de entrada', () => {
    const before = replay([start('r1')]);
    const frozen = Object.freeze([...before]);
    expect(() => applyCommandEvent(frozen, exit('r1'))).not.toThrow();
    expect(before[0]?.status).toBe('running');
  });
});
