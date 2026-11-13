import { LogoIcon } from './icons';

export function Header(props: { runningCount: number }) {
  return (
    <header className="app-header">
      <div className="app-brand">
        <LogoIcon />

        <span className="app-name">
          Inova<span className="app-name-accent">IDE</span>
        </span>
      </div>
      {props.runningCount > 0 ? (
        <span className="app-running">
          <span className="app-running-dot pulse" />
          {props.runningCount} executando
        </span>
      ) : null}
    </header>
  );
}
