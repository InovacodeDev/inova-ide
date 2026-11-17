import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  exitOf,
  kinds,
  microtasks,
  outputOf,
  request,
  setup,
} from './command-executor-fixtures.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('falhas ao iniciar', () => {
  test('binário ausente emite error tipado, não cria processo e libera a fila', async () => {
    let found = false;
    const { executor, spawnChild, events } = setup({
      findBinary: async () => (found ? '/bin/gh' : undefined),
    });
    await executor.run(request({ mutating: true }));
    await microtasks();
    expect(events.find((event) => event.kind === 'error')).toMatchObject({
      code: 'binary-not-found',
      binary: 'gh',
    });
    expect(spawnChild).not.toHaveBeenCalled();
    found = true;
    await executor.run(request({ mutating: true }));
    await microtasks();
    expect(spawnChild).toHaveBeenCalledTimes(1);
  });

  test('spawnChild que lança vira spawn-failed e libera a fila', async () => {
    const { executor, spawnChild, events } = setup();
    spawnChild.mockImplementationOnce(() => {
      throw new Error('EACCES');
    });
    await executor.run(request({ mutating: true }));
    await executor.run(request({ mutating: true }));
    await microtasks();
    expect(events.find((event) => event.kind === 'error')).toMatchObject({ code: 'spawn-failed' });
    expect(spawnChild).toHaveBeenCalledTimes(2);
  });

  test('evento error do filho sem pid com ENOENT vira binary-not-found', async () => {
    const { executor, children, events } = setup();
    await executor.run(request());
    await microtasks();
    const child = children[0];
    if (child === undefined) throw new Error('child ausente');
    child.pid = undefined;
    child.emit('error', Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }));
    expect(events.find((event) => event.kind === 'error')).toMatchObject({
      code: 'binary-not-found',
    });
  });

  test('falha ao resolver o ambiente vira spawn-failed', async () => {
    const { executor, spawnChild, events } = setup({
      env: async () => {
        throw new Error('sem shell');
      },
    });
    await executor.run(request());
    await microtasks();
    expect(spawnChild).not.toHaveBeenCalled();
    expect(events.find((event) => event.kind === 'error')).toMatchObject({ code: 'spawn-failed' });
  });

  test('o ambiente do filho desativa prompts interativos', async () => {
    const { executor, spawnChild } = setup();
    await executor.run(request());
    await microtasks();
    expect(spawnChild.mock.calls[0]?.[0].env).toMatchObject({
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0',
      NO_COLOR: '1',
    });
  });
});

describe('cancelamento', () => {
  test('cancelar enquanto o binário é resolvido não cria processo', async () => {
    let release: (path: string) => void = () => undefined;
    const { executor, spawnChild, events } = setup({
      findBinary: () => new Promise((resolve) => (release = resolve)),
    });
    const { runId } = await executor.run(request());
    await microtasks();
    executor.cancel(runId);
    release('/bin/gh');
    await microtasks();
    expect(spawnChild).not.toHaveBeenCalled();
    expect(exitOf(events)).toMatchObject({ cancelled: true, exitCode: null });
  });

  test('AbortSignal já abortado não cria processo', async () => {
    const { executor, spawnChild, events } = setup();
    const controller = new AbortController();
    controller.abort();
    await executor.run(request({ signal: controller.signal }));
    await microtasks();
    expect(spawnChild).not.toHaveBeenCalled();
    expect(exitOf(events)).toMatchObject({ cancelled: true });
  });

  test('abortar durante a execução envia SIGTERM', async () => {
    const { executor, killTree } = setup();
    const controller = new AbortController();
    await executor.run(request({ signal: controller.signal }));
    await microtasks();
    controller.abort();
    expect(killTree).toHaveBeenCalledWith(1000, 'SIGTERM');
  });

  test('cancelar um id desconhecido ou duas vezes não falha nem repete o sinal', async () => {
    const { executor, killTree } = setup();
    expect(() => executor.cancel('nao-existe')).not.toThrow();
    const { runId } = await executor.run(request());
    await microtasks();
    executor.cancel(runId);
    executor.cancel(runId);
    expect(killTree).toHaveBeenCalledTimes(1);
  });

  test('killTree que lança não derruba o executor e o SIGKILL ainda finaliza', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { executor, killTree, events } = setup();
    killTree.mockImplementation(() => {
      throw new Error('EPERM');
    });
    const { runId } = await executor.run(request());
    await microtasks();
    executor.cancel(runId);
    await vi.advanceTimersByTimeAsync(2000);
    expect(exitOf(events)).toBeDefined();
    errors.mockRestore();
  });

  test('closeAll cancela tudo o que está ativo e espera terminar', async () => {
    const { executor, children, killTree } = setup();
    await executor.run(request());
    await executor.run(request({ mutating: true }));
    await microtasks();
    let done = false;
    const closing = executor.closeAll().then(() => {
      done = true;
    });
    expect(killTree).toHaveBeenCalledTimes(2);
    await microtasks();
    expect(done).toBe(false);
    children.forEach((child) => child.emit('close', null));
    await closing;
    expect(done).toBe(true);
  });
});

describe('saída', () => {
  test('exit sem close (pipe preso por neto) termina após a tolerância', async () => {
    vi.useFakeTimers();
    const { executor, children, events } = setup();
    await executor.run(request());
    await microtasks();
    children[0]?.emit('exit', 3);
    expect(exitOf(events)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2000);
    expect(exitOf(events)).toMatchObject({ exitCode: 3 });
  });

  test('caractere multibyte dividido entre dois pedaços é decodificado inteiro', async () => {
    const { executor, children, events } = setup();
    await executor.run(request());
    await microtasks();
    const bytes = Buffer.from('café\n', 'utf8');
    children[0]?.stdout.write(bytes.subarray(0, 4));
    children[0]?.stdout.write(bytes.subarray(4));
    await microtasks();
    expect(outputOf(events)).toBe('café\n');
  });

  test('a última linha sem quebra é emitida ao fechar', async () => {
    const { executor, children, events } = setup();
    await executor.run(request());
    await microtasks();
    children[0]?.stdout.write('sem quebra');
    await microtasks();
    expect(outputOf(events)).toBe('');
    children[0]?.emit('close', 0);
    expect(outputOf(events)).toBe('sem quebra\n');
  });

  test('linha enorme sem quebra é emitida em pedaços limitados', async () => {
    const { executor, children, events } = setup();
    await executor.run(request({ maxOutputBytes: 1_000_000 }));
    await microtasks();
    children[0]?.stdout.write('a'.repeat(10_000));
    await microtasks();
    expect(outputOf(events).length).toBeGreaterThanOrEqual(8000);
  });

  test('saída depois do fim da execução é ignorada', async () => {
    const { executor, children, events } = setup();
    await executor.run(request());
    await microtasks();
    children[0]?.emit('close', 0);
    children[0]?.stdout.write('tarde demais\n');
    await microtasks();
    expect(outputOf(events)).toBe('');
    expect(kinds(events).filter((kind) => kind === 'exit')).toHaveLength(1);
  });

  test('um ouvinte que lança não impede os outros nem trava a fila', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { executor, children, events, spawnChild } = setup();
    executor.onEvent(() => {
      throw new Error('ui quebrou');
    });
    await executor.run(request({ mutating: true }));
    await executor.run(request({ mutating: true }));
    await microtasks();
    children[0]?.emit('close', 0);
    await microtasks();
    expect(spawnChild).toHaveBeenCalledTimes(2);
    expect(kinds(events)).toContain('exit');
    errors.mockRestore();
  });

  test('linha longa com token no fim continua mascarada', async () => {
    const { executor, children, events } = setup();
    await executor.run(request({ maxOutputBytes: 1_000_000 }));
    await microtasks();
    children[0]?.stdout.write(`${'a'.repeat(4090)} sk-${'b'.repeat(40)}\n`);
    await microtasks();
    expect(outputOf(events)).not.toContain('b'.repeat(40));
  });
});
