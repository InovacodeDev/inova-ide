import { useState } from 'react';
import type { Settings, SettingsPatch } from '@inova/core/types';
import type { TranslationKey } from './i18n';
import { useI18n } from './I18nContext';
import { Segmented, SettingGroup, SettingRow, Switch } from './settings-controls';
import {
  SHORTCUTS,
  formatBinding,
  groupShortcuts,
  shortcutGroupLabel,
  shortcutLabel,
} from './shortcuts';
import type { WarningCall } from './useWarning';

interface SettingsSectionProps {
  settings: Settings;
  onUpdate: (patch: SettingsPatch) => void;
}

export function GeneralSection({
  settings,
  onUpdate,
  call,
}: SettingsSectionProps & { call: WarningCall }) {
  const { t } = useI18n();
  const themeOptions: { value: Settings['appearance']['theme']; label: string }[] = [
    { value: 'system', label: t('settings.theme.system') },
    { value: 'dark', label: t('settings.theme.dark') },
    { value: 'light', label: t('settings.theme.light') },
  ];
  const localeOptions: { value: Settings['appearance']['locale']; label: string }[] = [
    { value: 'auto', label: t('settings.locale.auto') },
    { value: 'pt-BR', label: t('settings.locale.ptBR') },
    { value: 'en-US', label: t('settings.locale.enUS') },
  ];
  return (
    <>
      <SettingGroup title={t('settings.appearance.title')}>
        <SettingRow title={t('settings.theme.title')} description={t('settings.theme.desc')}>
          <Segmented
            name="theme"
            label={t('settings.theme.title')}
            value={settings.appearance.theme}
            options={themeOptions}
            onChange={(theme) => onUpdate({ appearance: { theme } })}
          />
        </SettingRow>
        <SettingRow title={t('settings.locale.title')} description={t('settings.locale.desc')}>
          <Segmented
            name="locale"
            label={t('settings.locale.title')}
            value={settings.appearance.locale}
            options={localeOptions}
            onChange={(locale) => onUpdate({ appearance: { locale } })}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title={t('settings.data.title')}>
        <SettingRow
          title={t('settings.data.folderTitle')}
          description={t('settings.data.folderDesc')}
        >
          <button
            type="button"
            className="btn"
            onClick={() => void call(() => window.inova.openDataFolder())}
          >
            {t('settings.data.openFolder')}
          </button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}

const ARCHIVE_OPTIONS: {
  value: Settings['sessions']['autoArchiveDays'];
  labelKey: TranslationKey;
}[] = [
  { value: 0, labelKey: 'settings.sessions.archive.0' },
  { value: 1, labelKey: 'settings.sessions.archive.1' },
  { value: 3, labelKey: 'settings.sessions.archive.3' },
  { value: 7, labelKey: 'settings.sessions.archive.7' },
  { value: 30, labelKey: 'settings.sessions.archive.30' },
];

const FAILOVER_OPTIONS: {
  value: Settings['sessions']['rateLimitFailover'];
  labelKey: TranslationKey;
}[] = [
  { value: 'off', labelKey: 'settings.sessions.failover.off' },
  { value: 'same-provider', labelKey: 'settings.sessions.failover.same' },
  { value: 'any-provider', labelKey: 'settings.sessions.failover.any' },
];

const TOOL_ERROR_OPTIONS: {
  value: Settings['sessions']['maxConsecutiveToolErrors'];
  labelKey: TranslationKey;
}[] = [
  { value: 0, labelKey: 'settings.sessions.toolErrors.0' },
  { value: 3, labelKey: 'settings.sessions.toolErrors.3' },
  { value: 5, labelKey: 'settings.sessions.toolErrors.5' },
  { value: 10, labelKey: 'settings.sessions.toolErrors.10' },
];

const VERIFICATION_FAILURE_OPTIONS: {
  value: Settings['sessions']['maxConsecutiveVerificationFailures'];
  labelKey: TranslationKey;
}[] = [
  { value: 0, labelKey: 'settings.sessions.verifyFailures.0' },
  { value: 2, labelKey: 'settings.sessions.verifyFailures.2' },
  { value: 3, labelKey: 'settings.sessions.verifyFailures.3' },
  { value: 5, labelKey: 'settings.sessions.verifyFailures.5' },
];

const SESSION_COST_OPTIONS: {
  value: Settings['sessions']['maxSessionCostUsd'];
  labelKey?: TranslationKey;
  label?: string;
}[] = [
  { value: 0, labelKey: 'settings.sessions.costCap.0' },
  { value: 1, label: '$1' },
  { value: 5, label: '$5' },
  { value: 10, label: '$10' },
  { value: 25, label: '$25' },
];

const CONTEXT_PERCENT_OPTIONS: {
  value: Settings['sessions']['maxContextPercent'];
  labelKey?: TranslationKey;
  label?: string;
}[] = [
  { value: 0, labelKey: 'settings.sessions.contextCap.0' },
  { value: 80, label: '80%' },
  { value: 90, label: '90%' },
  { value: 95, label: '95%' },
];

export function SessionsSection({ settings, onUpdate }: SettingsSectionProps) {
  const { t } = useI18n();
  return (
    <>
      <SettingGroup>
        <SettingRow
          title={t('settings.sessions.archiveTitle')}
          description={t('settings.sessions.archiveDesc')}
        >
          <Segmented
            name="auto-archive"
            label={t('settings.sessions.archiveTitle')}
            value={settings.sessions.autoArchiveDays}
            options={ARCHIVE_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
            onChange={(autoArchiveDays) => onUpdate({ sessions: { autoArchiveDays } })}
          />
        </SettingRow>
        <SettingRow
          htmlFor="collapse-finished-turns"
          title={t('settings.sessions.collapseTurnsTitle')}
          description={t('settings.sessions.collapseTurnsDesc')}
        >
          <Switch
            id="collapse-finished-turns"
            checked={settings.sessions.collapseFinishedTurns}
            onChange={(collapseFinishedTurns) => onUpdate({ sessions: { collapseFinishedTurns } })}
          />
        </SettingRow>
        <SettingRow
          title={t('settings.sessions.failoverTitle')}
          description={t('settings.sessions.failoverDesc')}
        >
          <Segmented
            name="rate-limit-failover"
            label={t('settings.sessions.failoverTitle')}
            value={settings.sessions.rateLimitFailover}
            options={FAILOVER_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
            onChange={(rateLimitFailover) => onUpdate({ sessions: { rateLimitFailover } })}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup
        title={t('settings.sessions.cbTitle')}
        description={t('settings.sessions.cbDesc')}
      >
        <SettingRow
          title={t('settings.sessions.toolErrorsTitle')}
          description={t('settings.sessions.toolErrorsDesc')}
        >
          <Segmented
            name="max-consecutive-tool-errors"
            label={t('settings.sessions.toolErrorsTitle')}
            value={settings.sessions.maxConsecutiveToolErrors}
            options={TOOL_ERROR_OPTIONS.map((opt) => ({
              value: opt.value,
              label: t(opt.labelKey),
            }))}
            onChange={(maxConsecutiveToolErrors) =>
              onUpdate({ sessions: { maxConsecutiveToolErrors } })
            }
          />
        </SettingRow>
        <SettingRow
          title={t('settings.sessions.verifyFailuresTitle')}
          description={t('settings.sessions.verifyFailuresDesc')}
        >
          <Segmented
            name="max-consecutive-verification-failures"
            label={t('settings.sessions.verifyFailuresTitle')}
            value={settings.sessions.maxConsecutiveVerificationFailures}
            options={VERIFICATION_FAILURE_OPTIONS.map((opt) => ({
              value: opt.value,
              label: t(opt.labelKey),
            }))}
            onChange={(maxConsecutiveVerificationFailures) =>
              onUpdate({ sessions: { maxConsecutiveVerificationFailures } })
            }
          />
        </SettingRow>
        <SettingRow
          title={t('settings.sessions.costCapTitle')}
          description={t('settings.sessions.costCapDesc')}
        >
          <Segmented
            name="max-session-cost-usd"
            label={t('settings.sessions.costCapTitle')}
            value={settings.sessions.maxSessionCostUsd}
            options={SESSION_COST_OPTIONS.map((opt) => ({
              value: opt.value,
              label: opt.labelKey ? t(opt.labelKey) : (opt.label ?? ''),
            }))}
            onChange={(maxSessionCostUsd) => onUpdate({ sessions: { maxSessionCostUsd } })}
          />
        </SettingRow>
        <SettingRow
          title={t('settings.sessions.contextCapTitle')}
          description={t('settings.sessions.contextCapDesc')}
        >
          <Segmented
            name="max-context-percent"
            label={t('settings.sessions.contextCapTitle')}
            value={settings.sessions.maxContextPercent}
            options={CONTEXT_PERCENT_OPTIONS.map((opt) => ({
              value: opt.value,
              label: opt.labelKey ? t(opt.labelKey) : (opt.label ?? ''),
            }))}
            onChange={(maxContextPercent) => onUpdate({ sessions: { maxContextPercent } })}
          />
        </SettingRow>
      </SettingGroup>
    </>
  );
}

const NOTIFICATION_ROWS: {
  key: keyof Settings['notifications'];
  titleKey: TranslationKey;
  descKey: TranslationKey;
}[] = [
  {
    key: 'waitingInput',
    titleKey: 'settings.notifications.waitingInputTitle',
    descKey: 'settings.notifications.waitingInputDesc',
  },
  {
    key: 'failed',
    titleKey: 'settings.notifications.failedTitle',
    descKey: 'settings.notifications.failedDesc',
  },
  {
    key: 'completed',
    titleKey: 'settings.notifications.completedTitle',
    descKey: 'settings.notifications.completedDesc',
  },
  {
    key: 'onlyWhenUnfocused',
    titleKey: 'settings.notifications.onlyUnfocusedTitle',
    descKey: 'settings.notifications.onlyUnfocusedDesc',
  },
];

export function NotificationsSection(props: SettingsSectionProps & { call: WarningCall }) {
  const { settings, onUpdate, call } = props;
  const { t } = useI18n();
  const [blocked, setBlocked] = useState<string | null>(null);

  // NOTE: the operating system only asks for notification permission when the app posts its
  // first notification, so posting one is how the permission is requested.
  const requestPermission = async (): Promise<void> => {
    const result = await window.inova.sendTestNotification();
    setBlocked(result.ok ? null : result.message);
  };

  return (
    <SettingGroup>
      {blocked !== null && (
        <div className="setting-alert" role="alert">
          <p>{blocked}</p>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void call(() => window.inova.openNotificationSettings())}
          >
            {t('settings.notifications.openSystemSettings')}
          </button>
        </div>
      )}
      {NOTIFICATION_ROWS.map((row) => {
        const id = `notification-${row.key}`;
        return (
          <SettingRow
            key={row.key}
            htmlFor={id}
            title={t(row.titleKey)}
            description={t(row.descKey)}
          >
            <Switch
              id={id}
              checked={settings.notifications[row.key]}
              onChange={(checked) => {
                onUpdate({ notifications: { [row.key]: checked } });
                if (checked && row.key !== 'onlyWhenUnfocused') void requestPermission();
              }}
            />
          </SettingRow>
        );
      })}
      <SettingRow
        title={t('settings.notifications.testTitle')}
        description={t('settings.notifications.testDesc')}
      >
        <button type="button" className="btn" onClick={() => void requestPermission()}>
          {t('settings.notifications.testBtn')}
        </button>
      </SettingRow>
    </SettingGroup>
  );
}

export function ShortcutsSection({ isMac }: { isMac: boolean }) {
  const { locale, t } = useI18n();
  return (
    <>
      {groupShortcuts(SHORTCUTS).map(({ group, items }) => {
        const groupTitle = shortcutGroupLabel(group, locale);
        return (
          <SettingGroup key={group} title={groupTitle}>
            <table
              className="shortcut-table"
              aria-label={t('settings.shortcuts.tableAria', { group: groupTitle })}
            >
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">{shortcutLabel(item.id, locale)}</th>
                    <td>
                      <kbd>{formatBinding(item.binding, isMac)}</kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SettingGroup>
        );
      })}
    </>
  );
}
