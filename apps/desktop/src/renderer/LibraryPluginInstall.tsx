import { useState } from 'react';
import type {
  AccountView,
  PluginLibraryItem,
  PluginInstallRecipe,
  Result,
  RunCommandInput,
  RunCommandOutcome,
} from '../shared/api';
import { useI18n } from './I18nContext';
import { accountsForProvider, pluginInstallState } from './library-state';
import { PlatformSelect } from './PlatformSelect';
import { accountDisplayName } from './provider-meta';
import './library.css';

export type RunCommand = (input: RunCommandInput) => Promise<Result<RunCommandOutcome>>;

interface PluginInstallProps {
  item: PluginLibraryItem;
  recipe: PluginInstallRecipe | undefined;
  accounts: readonly AccountView[];
  onRun: RunCommand;
}

export function LibraryPluginInstall({ item, recipe, accounts, onRun }: PluginInstallProps) {
  const { t } = useI18n();
  const candidates = accountsForProvider(accounts, item.definition.provider);
  const state = pluginInstallState({ recipe, accountCount: candidates.length });
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const selected = candidates.some((account) => account.id === accountId)
    ? accountId
    : (candidates[0]?.id ?? '');

  const install = async () => {
    if (state.kind !== 'ready' || selected === '') return;
    setRunning(true);
    try {
      const result = await onRun({
        commandId: state.commandId,
        params: state.params,
        accountId: selected,
      });
      if (!result.ok) {
        setMessage({ text: result.message, failed: true });
        return;
      }
      const started = result.value.status === 'started';
      setMessage({
        text: t(started ? 'library.plugin.started' : 'library.plugin.confirming'),
        failed: false,
      });
      setOpen(false);
    } catch (error: unknown) {
      console.error('inova: plugin install failed', error);
      setMessage({ text: t('alerts.unexpected'), failed: true });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="library-plugin">
      <button
        type="button"
        className="btn btn-sm"
        aria-expanded={open}
        disabled={state.kind !== 'ready'}
        onClick={() => setOpen((current) => !current)}
      >
        {t('library.plugin.install')}
      </button>
      {state.kind === 'unsupported' ? (
        <p className="library-hint library-plugin-note">
          {t('library.plugin.unsupported', {
            reason: state.reason ?? t('library.plugin.noRecipe'),
          })}
        </p>
      ) : null}
      {state.kind === 'no-account' ? (
        <p className="library-hint library-plugin-note">{t('library.plugin.noAccount')}</p>
      ) : null}
      {open ? (
        <div className="library-plugin-chooser">
          <PlatformSelect
            ariaLabel={t('library.plugin.account')}
            value={selected}
            options={candidates.map((account) => ({
              value: account.id,
              label: accountDisplayName(account),
            }))}
            onChange={setAccountId}
          />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={running || selected === ''}
            onClick={() => void install()}
          >
            {t('library.plugin.run')}
          </button>
        </div>
      ) : null}
      {message ? (
        <p
          className={
            message.failed
              ? 'library-error library-plugin-note'
              : 'library-hint library-plugin-note'
          }
          role={message.failed ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
