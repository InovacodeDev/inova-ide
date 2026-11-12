import { execFile } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PATH_MARKER = '__INOVA_PATH__';

export async function loginShellPath(ctx: {
  shell: string;
  fallback: string;
  timeoutMs: number;
}): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      ctx.shell,
      ['-ilc', `printf "${PATH_MARKER}%s" "$PATH"`],
      { timeout: ctx.timeoutMs, encoding: 'utf8' },
    );
    const index = stdout.lastIndexOf(PATH_MARKER);
    if (index === -1) return ctx.fallback;
    return stdout.slice(index + PATH_MARKER.length);
  } catch (error: unknown) {
    if (error instanceof Error) return ctx.fallback;
    throw error;
  }
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error) return false;
    throw error;
  }
}

export async function findBinary(name: string, pathValue: string): Promise<string | undefined> {
  for (const dir of pathValue.split(':')) {
    if (dir === '') continue;
    const candidate = join(dir, name);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}
