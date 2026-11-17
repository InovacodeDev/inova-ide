import { afterEach, describe, expect, test, vi } from 'vitest';
import { CommandLimitError } from '../src/main/command-executor.js';
import type { CommandExecutor } from '../src/main/command-executor.js';
import { createCommandHandlers } from '../src/main/command-handlers.js';
import { createCommandService } from '../src/main/command-service.js';
import { microtasks, outputOf, request, setup } from './command-executor-fixtures.js';

afterEach(() => {
  vi.useRealTimers();
});

const GITHUB_TOKEN = `ghp_${'a1B2'.repeat(9)}`;

async function outputFor(write: (stdout: NodeJS.WritableStream) => void): Promise<string> {
  const { executor, children, events } = setup();
  await executor.run(request({ maxOutputBytes: 1_000_000 }));
  await microtasks();
  const stdout = children[0]?.stdout;
  if (stdout === undefined) throw new Error('child ausente');
  write(stdout);
  await microtasks();
  children[0]?.emit('close', 0);
  return outputOf(events);
}

describe('máscara de segredo: formas que escapavam', () => {
  test.each([
    ['JSON com chave entre aspas', '{"password":"hunter2"}', 'hunter2'],
    ['chave e valor com espaço', '"api_key": "abc123secret"', 'abc123secret'],
    ['credencial em URL', 'https://oauth2:glpat-segredo@gitlab.com/x.git', 'glpat-segredo'],
    ['token colado em underscore', `x_${GITHUB_TOKEN}`, GITHUB_TOKEN],
  ])('%s', async (_label, line, secret) => {
    const text = await outputFor((out) => out.write(`${line}\n`));
    expect(text).not.toContain(secret);
  });

  test('linha longa com espaço no limite do pedaço não divide o token', async () => {
    const text = await outputFor((out) => out.write(`${'x'.repeat(4090)} ${GITHUB_TOKEN}\n`));
    expect(text).not.toContain(GITHUB_TOKEN);
    expect(text).not.toContain(GITHUB_TOKEN.slice(0, 20));
  });

  test('a mensagem do evento error também é mascarada', async () => {
    const { executor, events } = setup({
      findBinary: async () => {
        throw new Error('falhou com Bearer segredo-no-erro');
      },
    });
    await executor.run(request());
    await microtasks();
    const error = events.find((event) => event.kind === 'error');
    expect(error).toBeDefined();
    expect(JSON.stringify(error)).not.toContain('segredo-no-erro');
  });
});

describe('quebra de linha', () => {
  test('CRLF dividido entre dois pedaços não gera linha vazia', async () => {
    const text = await outputFor((out) => {
      out.write('a\r');
      out.write('\nb\n');
    });
    expect(text).toBe('a\nb\n');
  });

  test('um \\r final sem \\n é descartado ao fechar', async () => {
    const text = await outputFor((out) => out.write('fim\r'));
    expect(text).toBe('fim\n');
  });
});

describe('ciclo de vida', () => {
  test('exit sem close sinaliza SIGKILL ao grupo antes de encerrar', async () => {
    vi.useFakeTimers();
    const { executor, children, killTree } = setup();
    await executor.run(request());
    await microtasks();
    children[0]?.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(killTree).toHaveBeenCalledWith(1000, 'SIGKILL');
  });

  test('pasta de trabalho inexistente falha como spawn-failed, sem criar processo', async () => {
    const { executor, spawnChild, events } = setup({ cwdExists: async () => false });
    await executor.run(request());
    await microtasks();
    expect(spawnChild).not.toHaveBeenCalled();
    expect(events.find((event) => event.kind === 'error')).toMatchObject({
      code: 'spawn-failed',
      message: 'Pasta de trabalho não encontrada.',
    });
  });

  test('pasta existente segue o fluxo normal', async () => {
    const { executor, spawnChild } = setup({ cwdExists: async () => true });
    await executor.run(request());
    await microtasks();
    expect(spawnChild).toHaveBeenCalledTimes(1);
  });
});

describe('limite de execuções simultâneas', () => {
  test('a 17ª execução é recusada com CommandLimitError', async () => {
    const { executor } = setup();
    for (let index = 0; index < 16; index += 1) await executor.run(request());
    await expect(executor.run(request())).rejects.toBeInstanceOf(CommandLimitError);
  });

  test('terminar uma execução libera espaço', async () => {
    const { executor, children } = setup();
    for (let index = 0; index < 16; index += 1) await executor.run(request());
    await microtasks();
    children[0]?.emit('close', 0);
    await expect(executor.run(request())).resolves.toHaveProperty('runId');
  });

  test('o handler traduz o limite em recusa tipada, sem lançar', async () => {
    const run = vi.fn<CommandExecutor['run']>(async () => {
      throw new CommandLimitError();
    });
    const handlers = createCommandHandlers({
      service: createCommandService({
        projectPath: async () => undefined,
        ideRoot: '/i',
        neutralCwd: '/n',
      }),
      executor: { run, cancel: vi.fn() },
    });
    const result = await handlers.runCommand({ commandId: 'gh.version' });
    expect(result).toMatchObject({ ok: false });
  });
});
