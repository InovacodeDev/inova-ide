import { accountAdd, accountList, accountLogin, accountRm } from './account-commands.js';
import { USAGE, UsageError } from './cli-context.js';
import type { Context } from './cli-context.js';
import { AccountError } from './core/accounts.js';
import { StoreCorruptError } from './core/store.js';
import { projectBind, projectList, projectUnbind, runProject } from './project-commands.js';

export type { CliIO } from './cli-context.js';

async function dispatch(ctx: Context): Promise<number> {
  const separator = ctx.argv.indexOf('--');
  const head = separator === -1 ? ctx.argv : ctx.argv.slice(0, separator);
  const passthrough = separator === -1 ? [] : ctx.argv.slice(separator + 1);
  const [group, action, ...rest] = head;
  if (group === 'run' && action === undefined) return runProject(ctx, passthrough);
  switch (`${group} ${action}`) {
    case 'account add':
      return accountAdd(ctx, rest);
    case 'account login':
      return accountLogin(ctx, rest);
    case 'account list':
      return accountList(ctx);
    case 'account rm':
      return accountRm(ctx, rest);
    case 'project bind':
      return projectBind(ctx, rest);
    case 'project unbind':
      return projectUnbind(ctx, rest);
    case 'project list':
      return projectList(ctx);
    default:
      throw new UsageError(USAGE);
  }
}

export async function main(ctx: Context): Promise<number> {
  try {
    return await dispatch(ctx);
  } catch (error: unknown) {
    if (
      error instanceof AccountError ||
      error instanceof StoreCorruptError ||
      error instanceof UsageError
    ) {
      ctx.io.err(error.message);
      return 1;
    }
    throw error;
  }
}
