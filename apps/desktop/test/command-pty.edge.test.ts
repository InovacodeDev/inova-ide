import { afterEach, describe, expect, test, vi } from 'vitest';
import { exitOf, microtasks, outputOf, request, setupPty } from './command-executor-fixtures.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('pty: falhas e limites', () => {
  test('sem spawnPty injetado o comando pty falha com pty-unavailable e não cria processo', async () => {
    const { executor, spawnChild, events } = setupPtyWithout();
    await executor.run(request({ mode: 'pty' }));
    await microtasks();
    expect(spawnChild).not.toHaveBeenCalled();
    expect(events.find((event) => event.kind === 'error')).toMatchObject({
      code: 'pty-unavailable',
    });
  });

  test('spawnPty que lança vira spawn-failed e libera a fila mutante', async () => {
    const { executor, spawnPty, events } = setupPty();
    spawnPty.mockImplementationOnce(() => {
      throw new Error('forkpty falhou');
    });
    await executor.run(request({ mode: 'pty', mutating: true }));
    await executor.run(request({ mode: 'pty', mutating: true }));
    await microtasks();
    expect(events.find((event) => event.kind === 'error')).toMatchObject({ code: 'spawn-failed' });
    expect(spawnPty).toHaveBeenCalledTimes(2);
  });

  test('cancelar envia SIGHUP ao grupo e escala para SIGKILL', async () => {
    vi.useFakeTimers();
    const { executor, killTree, events } = setupPty();
    const { runId } = await executor.run(request({ mode: 'pty' }));
    await microtasks();
    executor.cancel(runId);
    expect(killTree).toHaveBeenCalledWith(7000, 'SIGHUP');
    await vi.advanceTimersByTimeAsync(2000);
    expect(killTree).toHaveBeenCalledWith(7000, 'SIGKILL');
    expect(exitOf(events)).toMatchObject({ cancelled: true });
  });

  test('o timeout também mata o pty', async () => {
    vi.useFakeTimers();
    const { executor, killTree, ptys, events } = setupPty();
    await executor.run(request({ mode: 'pty', timeoutMs: 3000 }));
    await microtasks();
    await vi.advanceTimersByTimeAsync(3000);
    expect(killTree).toHaveBeenCalledWith(7000, 'SIGHUP');
    ptys[0]?.emitExit(129);
    expect(exitOf(events)).toMatchObject({ timedOut: true, exitCode: 129 });
  });

  test('o limite de saída vale para o pty', async () => {
    const { executor, ptys, events } = setupPty();
    await executor.run(request({ mode: 'pty', maxOutputBytes: 5 }));
    await microtasks();
    ptys[0]?.emitData(`${'z'.repeat(50)}\n`);
    ptys[0]?.emitExit(0);
    expect(exitOf(events)).toMatchObject({ truncated: true });
    expect(outputOf(events)).toContain('zzzzz');
    expect(outputOf(events)).not.toContain('zzzzzz');
  });

  test('dados depois do exit são ignorados', async () => {
    const { executor, ptys, events } = setupPty();
    await executor.run(request({ mode: 'pty' }));
    await microtasks();
    ptys[0]?.emitExit(0);
    ptys[0]?.emitData('tarde\n');
    expect(outputOf(events)).toBe('');
  });
});

function setupPtyWithout() {
  const { spawnChild, events, executor } = setupPty({ spawnPty: undefined });
  return { spawnChild, events, executor };
}
