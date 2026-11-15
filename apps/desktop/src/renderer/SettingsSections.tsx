import { useState } from 'react';
import type { Settings, SettingsPatch } from '@inova/core/types';
import { useI18n } from './I18nContext';
import { Segmented, SettingGroup, SettingRow, Switch } from './settings-controls';
import { SHORTCUTS, formatBinding, groupShortcuts } from './shortcuts';
import type { WarningCall } from './useWarning';

interface SettingsSectionProps {
  settings: Settings;
  onUpdate: (patch: SettingsPatch) => void;
}

export function GeneralSection({ call }: { call: WarningCall }) {
  return (
    <SettingGroup title="Dados">
      <SettingRow
        title="Pasta de dados"
        description="Onde o InovaIDE guarda contas, sessões e configurações."
      >
        <button
          type="button"
          className="btn"
          onClick={() => void call(() => window.inova.openDataFolder())}
        >
          Abrir pasta de dados
        </button>
      </SettingRow>
    </SettingGroup>
  );
}

export function AppearanceSection({ settings, onUpdate }: SettingsSectionProps) {
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
    <SettingGroup>
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
  );
}

const ARCHIVE_OPTIONS: { value: Settings['sessions']['autoArchiveDays']; label: string }[] = [
  { value: 0, label: 'Nunca' },
  { value: 1, label: '1 dia' },
  { value: 3, label: '3 dias' },
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
];

const FAILOVER_OPTIONS: { value: Settings['sessions']['rateLimitFailover']; label: string }[] = [
  { value: 'off', label: 'Desativado' },
  { value: 'same-provider', label: 'Mesmo provedor' },
  { value: 'any-provider', label: 'Qualquer provedor' },
];

const TOOL_ERROR_OPTIONS: {
  value: Settings['sessions']['maxConsecutiveToolErrors'];
  label: string;
}[] = [
  { value: 0, label: 'Desativado' },
  { value: 3, label: '3 erros' },
  { value: 5, label: '5 erros' },
  { value: 10, label: '10 erros' },
];

const VERIFICATION_FAILURE_OPTIONS: {
  value: Settings['sessions']['maxConsecutiveVerificationFailures'];
  label: string;
}[] = [
  { value: 0, label: 'Desativado' },
  { value: 2, label: '2 falhas' },
  { value: 3, label: '3 falhas' },
  { value: 5, label: '5 falhas' },
];

const SESSION_COST_OPTIONS: {
  value: Settings['sessions']['maxSessionCostUsd'];
  label: string;
}[] = [
  { value: 0, label: 'Sem limite' },
  { value: 1, label: '$1' },
  { value: 5, label: '$5' },
  { value: 10, label: '$10' },
  { value: 25, label: '$25' },
];

const CONTEXT_PERCENT_OPTIONS: {
  value: Settings['sessions']['maxContextPercent'];
  label: string;
}[] = [
  { value: 0, label: 'Desativado' },
  { value: 80, label: '80%' },
  { value: 90, label: '90%' },
  { value: 95, label: '95%' },
];

export function SessionsSection({ settings, onUpdate }: SettingsSectionProps) {
  return (
    <>
      <SettingGroup>
        <SettingRow
          title="Arquivar sessões automaticamente"
          description="Arquiva sessões sem atividade pelo tempo escolhido. Sessões em execução, abertas em aba ou com item não lido na caixa de entrada não são arquivadas."
        >
          <Segmented
            name="auto-archive"
            label="Arquivar sessões automaticamente"
            value={settings.sessions.autoArchiveDays}
            options={ARCHIVE_OPTIONS}
            onChange={(autoArchiveDays) => onUpdate({ sessions: { autoArchiveDays } })}
          />
        </SettingRow>
        <SettingRow
          htmlFor="collapse-finished-turns"
          title="Recolher turnos concluídos"
          description="Esconde as ferramentas e os passos intermediários de turnos já terminados e mostra só a resposta final."
        >
          <Switch
            id="collapse-finished-turns"
            checked={settings.sessions.collapseFinishedTurns}
            onChange={(collapseFinishedTurns) => onUpdate({ sessions: { collapseFinishedTurns } })}
          />
        </SettingRow>
        <SettingRow
          title="Failover automático por limite"
          description="Quando uma conta atinge o limite de uso, troca automaticamente para outra conta elegível e retoma o turno sem pausar o fluxo."
        >
          <Segmented
            name="rate-limit-failover"
            label="Failover automático por limite"
            value={settings.sessions.rateLimitFailover}
            options={FAILOVER_OPTIONS}
            onChange={(rateLimitFailover) => onUpdate({ sessions: { rateLimitFailover } })}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup
        title="Proteção contra falhas em loop (Circuit Breaker)"
        description="Interrompe loops de erro e pausa a fila automaticamente antes de consumir sua quota."
      >
        <SettingRow
          title="Erros seguidos de ferramenta"
          description="Cancela o turno atual se ferramentas falharem repetidamente em sequência."
        >
          <Segmented
            name="max-consecutive-tool-errors"
            label="Erros seguidos de ferramenta"
            value={settings.sessions.maxConsecutiveToolErrors}
            options={TOOL_ERROR_OPTIONS}
            onChange={(maxConsecutiveToolErrors) =>
              onUpdate({ sessions: { maxConsecutiveToolErrors } })
            }
          />
        </SettingRow>
        <SettingRow
          title="Falhas seguidas de verificação"
          description="Pausa a sessão na primeira falha pós-turno e dispara alerta após falhas consecutivas."
        >
          <Segmented
            name="max-consecutive-verification-failures"
            label="Falhas seguidas de verificação"
            value={settings.sessions.maxConsecutiveVerificationFailures}
            options={VERIFICATION_FAILURE_OPTIONS}
            onChange={(maxConsecutiveVerificationFailures) =>
              onUpdate({ sessions: { maxConsecutiveVerificationFailures } })
            }
          />
        </SettingRow>
        <SettingRow
          title="Teto de custo por sessão"
          description="Pausa a fila ao atingir o valor acumulado na sessão."
        >
          <Segmented
            name="max-session-cost-usd"
            label="Teto de custo por sessão"
            value={settings.sessions.maxSessionCostUsd}
            options={SESSION_COST_OPTIONS}
            onChange={(maxSessionCostUsd) => onUpdate({ sessions: { maxSessionCostUsd } })}
          />
        </SettingRow>
        <SettingRow
          title="Teto de uso de contexto"
          description="Pausa a fila automaticamente quando a janela de contexto atingir o percentual."
        >
          <Segmented
            name="max-context-percent"
            label="Teto de uso de contexto"
            value={settings.sessions.maxContextPercent}
            options={CONTEXT_PERCENT_OPTIONS}
            onChange={(maxContextPercent) => onUpdate({ sessions: { maxContextPercent } })}
          />
        </SettingRow>
      </SettingGroup>
    </>
  );
}

const NOTIFICATION_ROWS: {
  key: keyof Settings['notifications'];
  title: string;
  description: string;
}[] = [
  {
    key: 'waitingInput',
    title: 'Agente aguarda sua ação',
    description: 'Avisa quando uma sessão pede uma aprovação ou uma resposta.',
  },
  {
    key: 'failed',
    title: 'Agente falhou',
    description: 'Avisa quando um turno termina com erro.',
  },
  {
    key: 'completed',
    title: 'Agente terminou',
    description: 'Avisa quando um turno termina sem erro.',
  },
  {
    key: 'onlyWhenUnfocused',
    title: 'Só notificar com a janela sem foco',
    description: 'Não avisa enquanto você está usando o app.',
  },
];

export function NotificationsSection(props: SettingsSectionProps & { call: WarningCall }) {
  const { settings, onUpdate, call } = props;
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
            Abrir ajustes de notificação
          </button>
        </div>
      )}
      {NOTIFICATION_ROWS.map((row) => {
        const id = `notification-${row.key}`;
        return (
          <SettingRow key={row.key} htmlFor={id} title={row.title} description={row.description}>
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
        title="Notificação de teste"
        description="Mostra uma notificação para conferir se o sistema a exibe."
      >
        <button type="button" className="btn" onClick={() => void requestPermission()}>
          Enviar notificação de teste
        </button>
      </SettingRow>
    </SettingGroup>
  );
}

export function ShortcutsSection({ isMac }: { isMac: boolean }) {
  return (
    <>
      {groupShortcuts(SHORTCUTS).map(({ group, items }) => (
        <SettingGroup key={group} title={group}>
          <table className="shortcut-table" aria-label={`Atalhos: ${group}`}>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">{item.label}</th>
                  <td>
                    <kbd>{formatBinding(item.binding, isMac)}</kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SettingGroup>
      ))}
    </>
  );
}
