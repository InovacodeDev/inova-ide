import { LogoIcon, RefreshIcon, SearchIcon, SettingsIcon } from './icons';
import type { SessionStatus } from './session-status';
import type { Tab } from './tabs';
import { TabBar } from './TabBar';

interface HeaderProps {
  runningCount: number;
  update: { latest: string; installing: boolean; onInstall: () => void } | null;
  onOpenCommandPalette?: () => void;
  onOpenSettings: () => void;
  tabs?: Tab[];
  activeTabId?: string | null;
  inWorkspace?: boolean;
  statusOf?: (sessionId: string) => SessionStatus | undefined;
  queuedCountOf?: (sessionId: string) => number;
  onActivateTab?: (sessionId: string) => void;
  onCloseTab?: (tab: Tab) => void;
}

export function Header({
  runningCount,
  update,
  onOpenCommandPalette,
  onOpenSettings,
  tabs,
  activeTabId = null,
  inWorkspace = false,
  statusOf,
  queuedCountOf,
  onActivateTab,
  onCloseTab,
}: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-brand">
        <LogoIcon />

        <span className="app-name">
          Inova<span className="app-name-accent">IDE</span>
        </span>
      </div>
      <div className="app-header-tabs">
        {tabs && tabs.length > 0 && statusOf && onActivateTab && onCloseTab ? (
          <TabBar
            tabs={tabs}
            active={inWorkspace ? (activeTabId ?? null) : null}
            statusOf={statusOf}
            queuedCountOf={queuedCountOf}
            onActivate={onActivateTab}
            onClose={onCloseTab}
          />
        ) : null}
      </div>
      <div className="app-header-actions">
        {runningCount > 0 ? (
          <span className="app-running">
            <span className="app-running-dot pulse" />
            {runningCount} executando
          </span>
        ) : null}
        {update ? (
          <button
            type="button"
            className="btn btn-sm app-update-btn"
            data-tooltip={`Instalar a versão v${update.latest} e reiniciar`}
            aria-busy={update.installing}
            disabled={update.installing}
            onClick={update.onInstall}
          >
            {update.installing ? (
              <span className="app-update-spinner" aria-hidden="true" />
            ) : (
              <RefreshIcon size={13} />
            )}
            {update.installing ? 'Atualizando…' : 'Reiniciar para atualizar'}
          </button>
        ) : null}
        {onOpenCommandPalette ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm app-command-palette-btn"
            aria-label="Abrir paleta de comandos"
            data-tooltip="Paleta de comandos"
            data-shortcut="open-command-palette"
            onClick={onOpenCommandPalette}
          >
            <SearchIcon size={14} />
            <span>Comandos</span>
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn"
          aria-label="Configurações"
          data-tooltip="Abrir configurações"
          data-shortcut="open-settings"
          onClick={onOpenSettings}
        >
          <SettingsIcon size={16} />
        </button>
      </div>
    </header>
  );
}
