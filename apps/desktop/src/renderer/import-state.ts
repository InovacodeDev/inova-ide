import type { ProviderId } from '@inova/core/types';
import type { AccountView, ExternalSessionView, ImportProvider } from '../shared/api';

export interface ImportGroup {
  provider: ImportProvider;
  sessions: ExternalSessionView[];
  accounts: AccountView[];
  defaultAccountId: string;
}

export function buildImportGroups(input: {
  sessions: readonly ExternalSessionView[];
  accounts: readonly AccountView[];
  projectProvider: ProviderId;
  projectAccountLabel: string;
}): ImportGroup[] {
  const providers = [...new Set(input.sessions.map((session) => session.provider))];
  return providers.map((provider) => {
    const accounts = input.accounts.filter((account) => account.provider === provider);
    const projectAccount =
      input.projectProvider === provider
        ? accounts.find((account) => account.label === input.projectAccountLabel)
        : undefined;
    return {
      provider,
      sessions: input.sessions.filter((session) => session.provider === provider),
      accounts,
      defaultAccountId: (projectAccount ?? accounts[0])?.id ?? '',
    };
  });
}

export function selectableIds(group: ImportGroup): string[] {
  if (group.accounts.length === 0) return [];
  return group.sessions.filter((session) => !session.imported).map((session) => session.id);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
