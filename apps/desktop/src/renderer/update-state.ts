import type { SupportedLocale } from '@inova/core/types';
import type { UpdateInfo, UpdateInstallStage } from '../shared/api';
import { translate } from './i18n';

export const UPDATE_DISMISSED_KEY = 'inova.update.dismissed';
export const LAST_SEEN_VERSION_KEY = 'inova.lastSeenVersion';
export const UPGRADE_COMMAND = 'brew update && brew upgrade --cask inova-ide';

export interface InstallStageView {
  label: string;
  percent: number;
}

const INSTALL_STAGES_PERCENT: Record<UpdateInstallStage, number> = {
  preparing: 5,
  fetching: 15,
  downloading: 35,
  finalizing: 90,
  restarting: 100,
};

export function installStageView(
  stage: UpdateInstallStage | null,
  locale: SupportedLocale = 'pt-BR',
): InstallStageView {
  if (stage === null) return { label: translate(locale, 'update.stage.init'), percent: 0 };
  return {
    label: translate(locale, `update.stage.${stage}`),
    percent: INSTALL_STAGES_PERCENT[stage],
  };
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

export function changelogTitle(input: {
  whatsNew: boolean;
  version: string | null;
  locale?: SupportedLocale;
}): string {
  const locale = input.locale ?? 'pt-BR';
  return input.whatsNew && input.version !== null
    ? translate(locale, 'changelog.titleVersion', { version: input.version })
    : translate(locale, 'changelog.title');
}
