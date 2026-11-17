import type { Result } from '../shared/api.js';
import type { CommandExecutor, ExecRequest } from './command-executor.js';
import { COMMANDS } from './ide-commands.js';
import type { CommandSpec } from './ide-commands.js';
import { fail, isRecord, ok } from './validation.js';

const MAX_ID_LENGTH = 255;

export interface CommandInput {
  commandId: unknown;
  params?: unknown;
  projectId?: unknown;
}

export interface CommandServiceDeps {
  executor: Pick<CommandExecutor, 'run'>;
  projectPath: (projectId: string) => Promise<string | undefined>;
  ideRoot: string;
  neutralCwd: string;
  registry?: Readonly<Record<string, CommandSpec>>;
}

export interface CommandService {
  resolve(input: CommandInput): Promise<Result<ExecRequest>>;
  run(input: CommandInput & { signal?: AbortSignal }): Promise<Result<{ runId: string }>>;
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= MAX_ID_LENGTH;
}

export function createCommandService(deps: CommandServiceDeps): CommandService {
  const registry = deps.registry ?? COMMANDS;

  async function cwdOf(spec: CommandSpec, projectId: unknown): Promise<Result<string>> {
    if (spec.cwd === 'ide-root') return ok(deps.ideRoot);
    if (spec.cwd === 'none') return ok(deps.neutralCwd);
    if (!isBoundedId(projectId)) return fail('Projeto não encontrado.');
    const path = await deps.projectPath(projectId);
    return path === undefined ? fail('Projeto não encontrado.') : ok(path);
  }

  async function resolve(input: CommandInput): Promise<Result<ExecRequest>> {
    if (!isRecord(input) || !isBoundedId(input.commandId)) return fail('Comando não permitido.');
    const { commandId } = input;
    if (!Object.hasOwn(registry, commandId)) return fail('Comando não permitido.');
    const spec = registry[commandId];
    if (spec === undefined) return fail('Comando não permitido.');
    const args = spec.parseArgs(input.params);
    if (args === undefined) return fail('Parâmetros inválidos.');
    const cwd = await cwdOf(spec, input.projectId);
    if (!cwd.ok) return cwd;
    const queueKey = spec.cwd === 'project' ? `project:${String(input.projectId)}` : 'global';
    return ok({
      commandId: spec.id,
      binary: spec.binary,
      args,
      cwd: cwd.value,
      mutating: spec.mutating,
      queueKey,
      mode: spec.mode,
      timeoutMs: spec.timeoutMs,
      maxOutputBytes: spec.maxOutputBytes,
    });
  }

  return {
    resolve,
    async run(input) {
      const resolved = await resolve(input);
      if (!resolved.ok) return resolved;
      const request: ExecRequest =
        input.signal === undefined ? resolved.value : { ...resolved.value, signal: input.signal };
      const { runId } = await deps.executor.run(request);
      return ok({ runId });
    },
  };
}
