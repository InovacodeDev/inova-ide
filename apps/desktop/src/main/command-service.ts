import type { ProviderId } from '@inova/core/types';
import type { Result } from '../shared/api.js';
import type { ExecRequest } from './command-executor.js';
import { COMMANDS } from './ide-commands.js';
import type { CommandSpec } from './ide-commands.js';
import { fail, isRecord, ok } from './validation.js';

const MAX_ID_LENGTH = 255;

export interface CommandInput {
  commandId: unknown;
  params?: unknown;
  projectId?: unknown;
  accountId?: unknown;
}

type ResolvedAccount = { id: string; env: Record<string, string> } | undefined;

export interface CommandServiceDeps {
  projectPath: (projectId: string) => Promise<string | undefined>;
  accountEnv?: (
    accountId: string,
    provider: ProviderId,
  ) => Promise<Record<string, string> | undefined>;
  ideRoot: string;
  neutralCwd: string;
  registry?: Readonly<Record<string, CommandSpec>>;
}

export interface CommandService {
  resolve(input: CommandInput): Promise<Result<ExecRequest>>;
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

  async function accountOf(
    spec: CommandSpec,
    accountId: unknown,
  ): Promise<Result<ResolvedAccount>> {
    if (spec.account === undefined) return ok(undefined);
    if (!isBoundedId(accountId) || deps.accountEnv === undefined) {
      return fail('Conta não encontrada.');
    }
    const env = await deps.accountEnv(accountId, spec.account.provider);
    return env === undefined ? fail('Conta não encontrada.') : ok({ id: accountId, env });
  }

  function queueKeyOf(spec: CommandSpec, projectId: unknown, account: ResolvedAccount): string {
    if (account !== undefined) return `account:${account.id}`;
    return spec.cwd === 'project' ? `project:${String(projectId)}` : 'global';
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
    const account = await accountOf(spec, input.accountId);
    if (!account.ok) return account;
    return ok({
      ...(account.value === undefined ? {} : { env: account.value.env }),
      commandId: spec.id,
      binary: spec.binary,
      args,
      cwd: cwd.value,
      mutating: spec.mutating,
      queueKey: queueKeyOf(spec, input.projectId, account.value),
      mode: spec.mode,
      timeoutMs: spec.timeoutMs,
      maxOutputBytes: spec.maxOutputBytes,
    });
  }

  return { resolve };
}
