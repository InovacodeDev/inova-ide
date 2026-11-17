import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CommandExecutor } from '../src/main/command-executor.js';
import { createCommandService } from '../src/main/command-service.js';
import { COMMANDS } from '../src/main/ide-commands.js';
import type { CommandSpec } from '../src/main/ide-commands.js';
import { exitOf, microtasks, outputOf, request, setupPty } from './command-executor-fixtures.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('regra 9: pty só abre quando o registro marca TTY', () => {
  test('comando exec nunca chama spawnPty', async () => {
    const { executor, spawnPty, spawnChild } = setupPty();
    await executor.run(request({ mode: 'exec' }));
    await executor.run(request());
    await microtasks();
    expect(spawnChild).toHaveBeenCalledTimes(2);
    expect(spawnPty).not.toHaveBeenCalled();
  });

  test('comando pty usa spawnPty e não spawnChild', async () => {
    const { executor, spawnPty, spawnChild } = setupPty();
    await executor.run(request({ mode: 'pty' }));
    await microtasks();
    expect(spawnPty).toHaveBeenCalledTimes(1);
    expect(spawnChild).not.toHaveBeenCalled();
  });

  test('a saída do pty passa por stripAnsi e máscara e o exit leva o código', async () => {
    const { executor, ptys, events } = setupPty();
    await executor.run(request({ mode: 'pty' }));
    await microtasks();
    ptys[0]?.emitData('\u001b[32mok\u001b[0m\r\nBearer segredo-do-pty\r\n');
    ptys[0]?.emitExit(0);
    expect(outputOf(events)).toBe('ok\nBearer ***\n');
    expect(exitOf(events)).toMatchObject({ exitCode: 0 });
  });

  test('o executor nunca escreve no pty (sem entrada do usuário)', async () => {
    const { executor, ptys } = setupPty();
    await executor.run(request({ mode: 'pty' }));
    await microtasks();
    ptys[0]?.emitData('Password: ');
    ptys[0]?.emitExit(1);
    expect(ptys[0]?.write).not.toHaveBeenCalled();
  });

  test('o registro decide o modo: o serviço repassa spec.mode', async () => {
    const run = vi.fn<CommandExecutor['run']>(async () => ({ runId: 'r' }));
    const ttySpec: CommandSpec = {
      id: 'test.tty',
      binary: 'tool',
      parseArgs: () => [],
      cwd: 'none',
      mode: 'pty',
      mutating: false,
      timeoutMs: 1000,
      maxOutputBytes: 100,
    };
    const service = createCommandService({
      executor: { run },
      projectPath: async () => undefined,
      ideRoot: '/i',
      neutralCwd: '/n',
      registry: { ...COMMANDS, 'test.tty': ttySpec },
    });
    await service.run({ commandId: 'test.tty' });
    await service.run({ commandId: 'gh.version' });
    expect(run.mock.calls[0]?.[0]).toMatchObject({ mode: 'pty' });
    expect(run.mock.calls[1]?.[0]).toMatchObject({ mode: 'exec' });
  });

  test('params do renderer não conseguem trocar o modo', async () => {
    const run = vi.fn(async () => ({ runId: 'r' }));
    const service = createCommandService({
      executor: { run },
      projectPath: async () => undefined,
      ideRoot: '/i',
      neutralCwd: '/n',
    });
    const refused = await service.run({ commandId: 'gh.version', params: { mode: 'pty' } });
    expect(refused.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('isolamento do SessionManager', () => {
  test('o executor só depende de SpawnPty e killTree, sem conta nem sessão', async () => {
    const { executor, spawnPty } = setupPty();
    await executor.run(request({ mode: 'pty' }));
    await microtasks();
    const call = spawnPty.mock.calls[0]?.[0];
    expect(Object.keys(call ?? {}).sort()).toEqual(['args', 'cols', 'cwd', 'env', 'file', 'rows']);
  });
});
