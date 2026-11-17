import { describe, expect, test, vi } from 'vitest';
import { resolveWindowsSpawn } from '@inova/win-env';
import type { ChildProcessLike, SpawnChild } from '../src/main/chat.js';
import { createCommandExecutor } from '../src/main/command-executor.js';
import type { CommandExecutor } from '../src/main/command-executor.js';
import { createCommandHandlers } from '../src/main/command-handlers.js';
import { createCommandService } from '../src/main/command-service.js';
import { FakeChild, microtasks } from './command-executor-fixtures.js';

function setup() {
  const run = vi.fn<CommandExecutor['run']>(async () => ({ runId: 'run-1' }));
  const cancel = vi.fn<CommandExecutor['cancel']>();
  const service = createCommandService({
    projectPath: async () => undefined,
    ideRoot: '/data/inova',
    neutralCwd: '/home/user',
  });
  const handlers = createCommandHandlers({ service, executor: { run, cancel } });
  return { run, cancel, handlers };
}

describe('regra 2: params inválidos são recusados antes de criar processo', () => {
  test('o handler recusa e o executor nunca é chamado', async () => {
    const { handlers, run } = setup();
    const results = await Promise.all([
      handlers.runCommand({ commandId: 'gh.extension.upgrade', params: { name: '; rm -rf /' } }),
      handlers.runCommand({ commandId: 'nao.existe' }),
      handlers.runCommand({ commandId: 'gh.version', params: { extra: 1 } }),
      handlers.runCommand('gh.version'),
      handlers.runCommand(undefined),
    ]);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  test('comando não mutante válido inicia direto', async () => {
    const { handlers, run } = setup();
    expect(await handlers.runCommand({ commandId: 'gh.version' })).toEqual({
      ok: true,
      value: { status: 'started', runId: 'run-1' },
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('regra 5: comando mutante pede confirmação com o argv final', () => {
  const upgrade = { commandId: 'gh.extension.upgrade', params: { name: 'owner/gh-foo' } };

  test('runCommand devolve o argv e não inicia nada', async () => {
    const { handlers, run } = setup();
    const result = await handlers.runCommand(upgrade);
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'needs-confirmation',
        argv: ['gh', 'extension', 'upgrade', 'owner/gh-foo'],
        cwd: '/home/user',
      },
    });
    expect(run).not.toHaveBeenCalled();
  });

  test('confirmar roda exatamente o argv que foi mostrado', async () => {
    const { handlers, run } = setup();
    const shown = await handlers.runCommand(upgrade);
    if (!shown.ok || shown.value.status !== 'needs-confirmation')
      throw new Error('sem confirmação');
    const started = await handlers.confirmCommand({ confirmationId: shown.value.confirmationId });
    expect(started).toEqual({ ok: true, value: { runId: 'run-1' } });
    const request = run.mock.calls[0]?.[0];
    expect([request?.binary, ...(request?.args ?? [])]).toEqual(shown.value.argv);
    expect(request?.mutating).toBe(true);
  });

  test('a confirmação vale uma vez só', async () => {
    const { handlers, run } = setup();
    const shown = await handlers.runCommand(upgrade);
    if (!shown.ok || shown.value.status !== 'needs-confirmation')
      throw new Error('sem confirmação');
    await handlers.confirmCommand({ confirmationId: shown.value.confirmationId });
    const again = await handlers.confirmCommand({ confirmationId: shown.value.confirmationId });
    expect(again.ok).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('regra 10: o mesmo comportamento no Windows', () => {
  async function runOn(platform: NodeJS.Platform, file: string) {
    const spawned: { file: string; args: string[] }[] = [];
    const resolved: ReturnType<typeof resolveWindowsSpawn>[] = [];
    const spawnChild = vi.fn<SpawnChild>((input) => {
      spawned.push({ file: input.file, args: input.args });
      resolved.push(resolveWindowsSpawn({ ...input, platform }));
      return new FakeChild() as unknown as ChildProcessLike;
    });
    const executor = createCommandExecutor({
      spawnChild,
      killTree: vi.fn(),
      env: async () => ({ ComSpec: 'C:\\Windows\\System32\\cmd.exe' }),
      findBinary: async (name) => (name === 'gh' ? file : undefined),
    });
    const service = createCommandService({
      projectPath: async () => undefined,
      ideRoot: '/i',
      neutralCwd: '/n',
    });
    const handlers = createCommandHandlers({ service, executor });
    const shown = await handlers.runCommand({
      commandId: 'gh.extension.upgrade',
      params: { name: 'owner/gh-foo' },
    });
    if (!shown.ok || shown.value.status !== 'needs-confirmation')
      throw new Error('sem confirmação');
    await handlers.confirmCommand({ confirmationId: shown.value.confirmationId });
    await microtasks();
    return { spawned: spawned[0], resolved: resolved[0] };
  }

  test('o argv entregue ao spawn é o mesmo em macOS e Windows', async () => {
    const posix = await runOn('darwin', '/opt/homebrew/bin/gh');
    const win = await runOn('win32', 'C:\\Users\\u\\AppData\\Local\\gh.cmd');
    expect(win.spawned?.args).toEqual(posix.spawned?.args);
    expect(posix.spawned?.args).toEqual(['extension', 'upgrade', 'owner/gh-foo']);
  });

  test('um shim .cmd roda via cmd.exe sem interpolar nada além do argv', async () => {
    const win = await runOn('win32', 'C:\\Users\\u\\AppData\\Local\\gh.cmd');
    expect(win.resolved).toMatchObject({
      file: 'C:\\Windows\\System32\\cmd.exe',
      verbatimArgs:
        '/d /s /c "C:\\Users\\u\\AppData\\Local\\gh.cmd extension upgrade owner/gh-foo"',
    });
  });

  test('no macOS o binário roda direto, sem shell', async () => {
    const posix = await runOn('darwin', '/opt/homebrew/bin/gh');
    expect(posix.resolved).toEqual({
      file: '/opt/homebrew/bin/gh',
      args: ['extension', 'upgrade', 'owner/gh-foo'],
    });
  });
});
