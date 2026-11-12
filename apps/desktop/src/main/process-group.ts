export type SignalSender = (pid: number, signal: NodeJS.Signals) => unknown;

function errnoCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

export function killProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
  send: SignalSender = (target, sig) => process.kill(target, sig),
): void {
  if (!Number.isInteger(pid) || pid <= 1) throw new RangeError(`invalid process id: ${pid}`);
  try {
    send(-pid, signal);
    return;
  } catch (error: unknown) {
    const code = errnoCode(error);
    if (code !== 'ESRCH' && code !== 'EPERM') throw error;
  }
  try {
    send(pid, signal);
  } catch (error: unknown) {
    if (errnoCode(error) !== 'ESRCH') throw error;
  }
}
