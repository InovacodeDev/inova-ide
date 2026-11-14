import type { UpdateInfo, UpdateInstallStage } from '../shared/api';

export const UPDATE_DISMISSED_KEY = 'inova.update.dismissed';
export const LAST_SEEN_VERSION_KEY = 'inova.lastSeenVersion';
export const UPGRADE_COMMAND = 'brew update && brew upgrade --cask inova-ide';

export interface InstallStageView {
  label: string;
  percent: number;
}

const INSTALL_STAGES: Record<UpdateInstallStage, InstallStageView> = {
  preparing: { label: 'Preparando a atualização…', percent: 5 },
  fetching: { label: 'Atualizando o Homebrew…', percent: 15 },
  downloading: { label: 'Baixando e instalando a versão nova…', percent: 35 },
  finalizing: { label: 'Finalizando a instalação…', percent: 90 },
  restarting: { label: 'Reiniciando o Inova…', percent: 100 },
};

export function installStageView(stage: UpdateInstallStage | null): InstallStageView {
  return stage === null ? { label: 'Iniciando…', percent: 0 } : INSTALL_STAGES[stage];
}

export function isUpdateDismissed(input: { dismissed: string | null; latest: string | null }) {
  return input.latest !== null && input.dismissed === input.latest;
}

export function shouldShowUpdateToast(input: {
  info: UpdateInfo | null;
  dismissed: string | null;
}): boolean {
  const { info, dismissed } = input;
  if (!info || !info.available) return false;
  return !isUpdateDismissed({ dismissed, latest: info.latest });
}

export function shouldShowWhatsNew(input: { lastSeen: string | null; current: string }): boolean {
  return input.lastSeen !== null && input.lastSeen !== '' && input.lastSeen !== input.current;
}

const UNRELEASED_HEADING = /^## \[(?:Não lançado|Unreleased)\]/i;
const SECTION_HEADING = /^## /;

export function publishedChangelog(source: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => UNRELEASED_HEADING.test(line));
  if (start === -1) return source;
  const nextOffset = lines.slice(start + 1).findIndex((line) => SECTION_HEADING.test(line));
  const kept =
    nextOffset === -1
      ? lines.slice(0, start)
      : [...lines.slice(0, start), ...lines.slice(start + 1 + nextOffset)];
  return `${kept.join('\n').trimEnd()}\n`;
}

export function changelogTitle(input: { whatsNew: boolean; version: string | null }): string {
  return input.whatsNew && input.version !== null
    ? `Novidades da versão ${input.version}`
    : 'Novidades';
}
