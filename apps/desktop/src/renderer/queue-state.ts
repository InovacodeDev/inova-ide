export function queueCountLabel(count: number): string {
  return `${count} na fila`;
}

export function queuedCardLabel(waitingForAccount: boolean): string {
  return waitingForAccount ? 'Na fila — aguardando conta ficar livre' : 'Na fila';
}

export function isAccountBusyElsewhere(input: {
  sessionId: string;
  accountId: string | undefined;
  runningAccounts: ReadonlyMap<string, string | undefined>;
}): boolean {
  if (input.accountId === undefined) return false;
  for (const [sessionId, accountId] of input.runningAccounts) {
    if (sessionId !== input.sessionId && accountId === input.accountId) return true;
  }
  return false;
}
