import { useEffect, useState } from 'react';
import { activeRunCount, formatArgv, isActiveRun } from './command-runs-state';
import type { CommandRunStatus, CommandRunView } from './command-runs-state';
import { useI18n } from './I18nContext';
import type { TranslationKey } from './i18n';
import './command-runs.css';

const STATUS_KEY: Record<CommandRunStatus, TranslationKey> = {
  queued: 'commands.status.queued',
  running: 'commands.status.running',
  succeeded: 'commands.status.succeeded',
  failed: 'commands.status.failed',
  cancelled: 'commands.status.cancelled',
  'timed-out': 'commands.status.timedOut',
  error: 'commands.status.error',
};

interface CommandRunsIndicatorProps {
  runs: readonly CommandRunView[];
  onCancel: (runId: string) => void;
}

export function CommandRunsIndicator({ runs, onCancel }: CommandRunsIndicatorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (runs.length === 0) return null;
  const active = activeRunCount(runs);

  return (
    <div
      className="command-runs"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="command-runs-btn"
        aria-expanded={open}
        aria-label={t('commands.indicatorAria', { count: active })}
        onClick={() => setOpen((current) => !current)}
      >
        {t('commands.indicator')}
        {active > 0 ? <span className="command-runs-badge mono">{active}</span> : null}
      </button>
      {open ? (
        <section className="command-runs-popover" aria-label={t('commands.popoverTitle')}>
          <header className="command-runs-head">{t('commands.popoverTitle')}</header>
          <ul className="command-runs-list">
            {runs.map((run) => (
              <li key={run.runId} className="command-run">
                <div className="command-run-head">
                  <code className="command-run-argv mono">{formatArgv(run.argv)}</code>
                  <span className={`command-run-status command-run-status-${run.status}`}>
                    {t(STATUS_KEY[run.status])}
                  </span>
                  {isActiveRun(run) ? (
                    <button type="button" className="btn" onClick={() => onCancel(run.runId)}>
                      {t('commands.cancel')}
                    </button>
                  ) : null}
                </div>
                <pre className="command-run-output mono" tabIndex={0}>
                  {run.errorMessage ?? (run.output === '' ? t('commands.outputEmpty') : run.output)}
                </pre>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
