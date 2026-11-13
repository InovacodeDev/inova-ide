import { LogoIcon, SettingsIcon } from './icons';

interface HeaderProps {
  runningCount: number;
  onOpenSettings: () => void;
}

export function Header({ runningCount, onOpenSettings }: HeaderProps) {
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
