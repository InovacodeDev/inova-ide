import { useState } from 'react';
import { PROVIDER_MODES } from '@inova/core/modes';
import type { ExecutionMode, ProviderId, Settings, SettingsPatch } from '@inova/core/types';
import { effectiveModeForSession } from './mode-picker-state';
import { PlatformSelect } from './PlatformSelect';
import { PROVIDER_NAME } from './provider-meta';
import { Segmented, SettingGroup, SettingRow, Switch } from './settings-controls';
import { SHORTCUTS, formatBinding, groupShortcuts } from './shortcuts';
import type { WarningCall } from './useWarning';

interface SettingsSectionProps {
  settings: Settings;
  onUpdate: (patch: SettingsPatch) => void;
}

const PROVIDERS = Object.keys(PROVIDER_MODES) as ProviderId[];

export function GeneralSection(props: {
  defaultModes: Partial<Record<ProviderId, ExecutionMode>>;
  call: WarningCall;
  onSetDefaultMode: (provider: ProviderId, mode: ExecutionMode) => void;
}) {
  const { defaultModes, call, onSetDefaultMode } = props;
  return (
    <>
      <SettingGroup
        title="Modo de execução padrão"
        description="Modo usado nas novas sessões de cada provedor. Cada sessão ainda pode mudar o próprio modo."
      >
        {PROVIDERS.map((provider) => {
          const catalog = PROVIDER_MODES[provider];
          return (
            <SettingRow key={provider} title={PROVIDER_NAME[provider]}>
              <PlatformSelect
                ariaLabel={`Modo padrão: ${PROVIDER_NAME[provider]}`}
                value={effectiveModeForSession({ provider, defaultModes })}
                options={catalog.options.map((option) => ({
                  value: option.id,
                  label: option.label,
                  description: option.description,
                }))}
                onChange={(value) => {
                  const chosen = catalog.options.find((option) => option.id === value);
                  if (chosen) onSetDefaultMode(provider, chosen.id);
                }}
              />
            </SettingRow>
          );
        })}
      </SettingGroup>
      <SettingGroup title="Dados">
        <SettingRow
          title="Pasta de dados"
          description="Onde o Inova IDE guarda contas, sessões e configurações."
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
    </>
  );
}

const THEME_OPTIONS: { value: Settings['appearance']['theme']; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' },
];

export function AppearanceSection({ settings, onUpdate }: SettingsSectionProps) {
  return (
    <SettingGroup>
      <SettingRow title="Tema" description="Sistema segue a aparência do seu computador.">
        <Segmented
          name="theme"
          label="Tema"
          value={settings.appearance.theme}
          options={THEME_OPTIONS}
          onChange={(theme) => onUpdate({ appearance: { theme } })}
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

export function SessionsSection({ settings, onUpdate }: SettingsSectionProps) {
  return (
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
    </SettingGroup>
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
