import { afterEach, describe, expect, test, vi } from 'vitest';
import type { RunCommandOutcome } from '../src/shared/api.js';
import type { CommandExecutor } from '../src/main/command-executor.js';
import { createCommandHandlers } from '../src/main/command-handlers.js';
import { createCommandService } from '../src/main/command-service.js';
import { parseCommandRunId, parseConfirmCommand, parseRunCommand } from '../src/main/validation.js';

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const run = vi.fn<CommandExecutor['run']>(async () => ({ runId: 'run-1' }));
  const cancel = vi.fn<CommandExecutor['cancel']>();
  const handlers = createCommandHandlers({
    service: createCommandService({
      projectPath: async () => undefined,
      ideRoot: '/i',
      neutralCwd: '/n',
    }),
    executor: { run, cancel },
  });
  return { run, cancel, handlers };
}

const upgrade = { commandId: 'gh.extension.upgrade', params: { name: 'gh-foo' } };

async function pendingConfirmation(handlers: ReturnType<typeof setup>['handlers']) {
  const result = await handlers.runCommand(upgrade);
  if (!result.ok || result.value.status !== 'needs-confirmation')
    throw new Error('sem confirmação');
  return result.value as Extract<RunCommandOutcome, { status: 'needs-confirmation' }>;
}

describe('confirmação', () => {
  test('uma confirmação expira depois de 5 minutos', async () => {
    vi.useFakeTimers();
    const { handlers, run } = setup();
    const pending = await pendingConfirmation(handlers);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    const result = await handlers.confirmCommand({ confirmationId: pending.confirmationId });
    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  test('um id de confirmação desconhecido é recusado', async () => {
    const { handlers, run } = setup();
    expect((await handlers.confirmCommand({ confirmationId: 'inventado' })).ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  test('o runId de uma execução não serve como confirmação', async () => {
    const { handlers, run } = setup();
    const started = await handlers.runCommand({ commandId: 'gh.version' });
    expect(started).toMatchObject({ value: { runId: 'run-1' } });
    expect((await handlers.confirmCommand({ confirmationId: 'run-1' })).ok).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('cada pedido mutante gera uma confirmação distinta', async () => {
    const { handlers } = setup();
    const first = await pendingConfirmation(handlers);
    const second = await pendingConfirmation(handlers);
    expect(first.confirmationId).not.toBe(second.confirmationId);
  });

  test('no máximo 20 confirmações pendentes: a mais antiga cai', async () => {
    const { handlers, run } = setup();
    const first = await pendingConfirmation(handlers);
    for (let index = 0; index < 20; index += 1) await pendingConfirmation(handlers);
    expect((await handlers.confirmCommand({ confirmationId: first.confirmationId })).ok).toBe(
      false,
    );
    expect(run).not.toHaveBeenCalled();
  });

  test('confirmCommand recusa entrada malformada', async () => {
    const { handlers } = setup();
    for (const input of [
      undefined,
      null,
      'x',
      {},
      { confirmationId: 42 },
      { confirmationId: '' },
    ]) {
      expect((await handlers.confirmCommand(input)).ok).toBe(false);
    }
  });
});

describe('cancelCommand', () => {
  test('repassa um runId válido ao executor', () => {
    const { handlers, cancel } = setup();
    handlers.cancelCommand('run-1');
    expect(cancel).toHaveBeenCalledWith('run-1');
  });

  test('ignora entradas que não são um id seguro', () => {
    const { handlers, cancel } = setup();
    for (const input of [undefined, 42, {}, '', '../x', 'a/b', 'x'.repeat(300)]) {
      handlers.cancelCommand(input);
    }
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('validação do IPC', () => {
  test.each([
    undefined,
    null,
    'texto',
    {},
    { commandId: '' },
    { commandId: 42 },
    { commandId: 'gh.version', projectId: '../x' },
    { commandId: 'gh.version', projectId: 42 },
    { commandId: 'gh.version', params: { a: 'x'.repeat(5000) } },
  ])('parseRunCommand recusa %j', (input) => {
    expect(parseRunCommand(input)).toBeUndefined();
  });

  test('parseRunCommand recusa params circulares', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(parseRunCommand({ commandId: 'gh.version', params: circular })).toBeUndefined();
  });

  test('parseRunCommand aceita a forma mínima e a completa', () => {
    expect(parseRunCommand({ commandId: 'gh.version' })).toEqual({ commandId: 'gh.version' });
    expect(parseRunCommand({ commandId: 'a.b', params: { x: 1 }, projectId: 'p1' })).toEqual({
      commandId: 'a.b',
      params: { x: 1 },
      projectId: 'p1',
    });
  });

  test('parseConfirmCommand e parseCommandRunId só aceitam ids seguros', () => {
    expect(parseConfirmCommand({ confirmationId: 'abc' })).toEqual({ confirmationId: 'abc' });
    expect(parseConfirmCommand({ confirmationId: 'a\0b' })).toBeUndefined();
    expect(parseCommandRunId('abc')).toBe('abc');
    expect(parseCommandRunId('..')).toBeUndefined();
  });

  test('um commandId de texto livre com shell nunca chega ao executor', async () => {
    const { handlers, run } = setup();
    const result = await handlers.runCommand({ commandId: 'gh --version && rm -rf /' });
    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
