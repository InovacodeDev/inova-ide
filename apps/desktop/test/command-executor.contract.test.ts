import { afterEach, describe, expect, test, vi } from 'vitest';
import { TRUNCATION_MARKER } from '../src/shared/command-types.js';
import { exitOf, microtasks, outputOf, request, setup } from './command-executor-fixtures.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('regra 4: comando mutante roda um por vez por projeto', () => {
  test('o segundo mutante do mesmo projeto espera o primeiro terminar', async () => {
    const { executor, spawnChild, children, events } = setup();
    await executor.run(request({ mutating: true }));
    await executor.run(request({ mutating: true }));
    await microtasks();
    expect(spawnChild).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.kind === 'queued')).toHaveLength(1);
    children[0]?.emit('close', 0);
    await microtasks();
    expect(spawnChild).toHaveBeenCalledTimes(2);
  });

  test('mutantes de projetos diferentes rodam em paralelo', async () => {
    const { executor, spawnChild } = setup();
    await executor.run(request({ mutating: true, queueKey: 'a' }));
    await executor.run(request({ mutating: true, queueKey: 'b' }));
    await microtasks();
    expect(spawnChild).toHaveBeenCalledTimes(2);
  });

  test('comando não mutante roda em paralelo, mesmo com um mutante ativo', async () => {
    const { executor, spawnChild } = setup();
    await executor.run(request({ mutating: true }));
    await executor.run(request({ mutating: false }));
    await executor.run(request({ mutating: false }));
    await microtasks();
    expect(spawnChild).toHaveBeenCalledTimes(3);
  });
});

describe('regra 6: timeout e cancelamento matam a árvore de processos', () => {
  test('cancelar envia SIGTERM ao grupo e termina quando o processo fecha', async () => {
    const { executor, killTree, children, events } = setup();
    const { runId } = await executor.run(request());
    await microtasks();
    executor.cancel(runId);
    expect(killTree).toHaveBeenCalledWith(1000, 'SIGTERM');
    expect(exitOf(events)).toBeUndefined();
    children[0]?.emit('close', null);
    expect(exitOf(events)).toMatchObject({ cancelled: true, timedOut: false });
  });

  test('processo que ignora SIGTERM recebe SIGKILL depois de 2 s', async () => {
    vi.useFakeTimers();
    const { executor, killTree, events } = setup();
    const { runId } = await executor.run(request());
    await microtasks();
    executor.cancel(runId);
    await vi.advanceTimersByTimeAsync(2000);
    expect(killTree).toHaveBeenCalledWith(1000, 'SIGKILL');
    expect(exitOf(events)).toMatchObject({ cancelled: true });
  });

  test('o timeout mata o processo e marca timedOut', async () => {
    vi.useFakeTimers();
    const { executor, killTree, children, events } = setup();
    await executor.run(request({ timeoutMs: 5000 }));
    await microtasks();
    await vi.advanceTimersByTimeAsync(5000);
    expect(killTree).toHaveBeenCalledWith(1000, 'SIGTERM');
    children[0]?.emit('close', null);
    expect(exitOf(events)).toMatchObject({ timedOut: true, cancelled: false });
  });

  test('cancelar um comando na fila não cria processo e libera o próximo', async () => {
    const { executor, spawnChild, children, events } = setup();
    await executor.run(request({ mutating: true }));
    const queued = await executor.run(request({ mutating: true }));
    await executor.run(request({ mutating: true }));
    await microtasks();
    executor.cancel(queued.runId);
    expect(events.find((event) => event.kind === 'exit')).toMatchObject({
      runId: queued.runId,
      cancelled: true,
    });
    children[0]?.emit('close', 0);
    await microtasks();
    expect(spawnChild).toHaveBeenCalledTimes(2);
  });
});

describe('regra 7: a saída passa por stripAnsi e pela máscara de segredo', () => {
  test('remove sequências ANSI', async () => {
    const { executor, children, events } = setup();
    await executor.run(request());
    await microtasks();
    children[0]?.stdout.write('\u001b[31mfalhou\u001b[0m\n');
    await microtasks();
    expect(outputOf(events)).toBe('falhou\n');
  });

  test('mascara Bearer, token de GitHub e atribuição de variável secreta', async () => {
    const { executor, children, events } = setup();
    await executor.run(request());
    await microtasks();
    children[0]?.stdout.write('Authorization: Bearer abc123segredo\n');
    children[0]?.stdout.write('token ghp_abcdefghijklmnopqrstuvwxyz0123456789\n');
    children[0]?.stdout.write('GH_TOKEN=valor-secreto\n');
    await microtasks();
    const text = outputOf(events);
    expect(text).not.toContain('abc123segredo');
    expect(text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(text).not.toContain('valor-secreto');
  });

  test('mascara um segredo dividido entre dois pedaços de saída', async () => {
    const { executor, children, events } = setup();
    await executor.run(request());
    await microtasks();
    children[0]?.stdout.write('token ghp_abcdefghijklmnop');
    await microtasks();
    children[0]?.stdout.write('qrstuvwxyz0123456789\n');
    await microtasks();
    expect(outputOf(events)).not.toContain('ghp_abcdefghijklmnop');
    expect(outputOf(events)).not.toContain('qrstuvwxyz0123456789');
  });

  test('a saída do stderr também é mascarada', async () => {
    const { executor, children, events } = setup();
    await executor.run(request());
    await microtasks();
    children[0]?.stderr.write('Bearer segredo-no-stderr\n');
    await microtasks();
    expect(outputOf(events)).not.toContain('segredo-no-stderr');
  });

  test('corta a saída em maxOutputBytes e marca truncated', async () => {
    const { executor, children, events } = setup();
    await executor.run(request({ maxOutputBytes: 10 }));
    await microtasks();
    children[0]?.stdout.write(`${'x'.repeat(100)}\n`);
    await microtasks();
    children[0]?.emit('close', 0);
    const text = outputOf(events);
    expect(text).toContain(TRUNCATION_MARKER);
    expect(text.replace(`\n${TRUNCATION_MARKER}\n`, '')).toBe('x'.repeat(10));
    expect(exitOf(events)).toMatchObject({ truncated: true, exitCode: 0 });
  });
});
