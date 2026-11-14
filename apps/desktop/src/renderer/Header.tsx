import { LogoIcon, RefreshIcon, SettingsIcon } from './icons';

interface HeaderProps {
  runningCount: number;
  update: { latest: string; installing: boolean; onInstall: () => void } | null;
  onOpenSettings: () => void;
}

export function Header({ runningCount, update, onOpenSettings }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-brand">
        <LogoIcon />

        <span className="app-name">
          Inova<span className="app-name-accent">IDE</span>
        </span>
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
