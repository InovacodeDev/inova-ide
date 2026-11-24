import { useCallback, useEffect, useRef, useState } from 'react';
import type { GithubStatus } from '../shared/api';
import { ConfirmModal } from './ConfirmModal';
import { useI18n } from './I18nContext';
import { SettingGroup, SettingRow } from './settings-controls';
import type { WarningCall } from './useWarning';

type Phase = 'idle' | 'starting' | 'waiting-code' | 'code';

interface DeviceCode {
  code: string;
  url: string;
}

export function GithubSection({ call }: { call: WarningCall }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const phaseRef = useRef<Phase>('idle');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  phaseRef.current = phase;

  const refresh = useCallback(async () => {
    const loaded = await call(() => window.inova.getGithubStatus());
    if (loaded) setStatus(loaded.value);
  }, [call]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () =>
      window.inova.onGithubLoginEvent((event) => {
        if (event.type === 'code-ready') {
          setDevice({ code: event.code, url: event.url });
          setPhase('code');
          return;
        }
        setDevice(null);
        setPhase('idle');
        if (event.type === 'failed') setError(event.message);
        else void refresh();
      }),
    [refresh],
  );

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      if (phaseRef.current !== 'idle') void window.inova.cancelGithubLogin();
    },
    [],
  );

  const connect = async () => {
    setError(null);
    setPhase('starting');
    const result = await window.inova.startGithubLogin();
    if (!result.ok) {
      setError(result.message);
      setPhase('idle');
      return;
    }
    setPhase((current) => (current === 'starting' ? 'waiting-code' : current));
  };

  const cancel = async () => {
    await window.inova.cancelGithubLogin();
    setDevice(null);
    setPhase('idle');
  };

  const copyCode = async () => {
    if (!device) return;
    try {
      await navigator.clipboard.writeText(device.code);
    } catch {
      return;
    }
    setCopied(true);
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const disconnect = async () => {
    setConfirming(false);
    setDisconnecting(true);
    const result = await call(() => window.inova.logoutGithub());
    setDisconnecting(false);
    if (result) await refresh();
  };

  const busy = phase !== 'idle';

  const statusRow = () => {
    if (status === null) return <p className="setting-row-desc">{t('settings.github.checking')}</p>;
    if (!status.installed) {
      return (
        <SettingRow
          title={t('settings.github.notInstalled')}
          description={t('settings.github.installHint')}
        >
          <button type="button" className="btn btn-sm" onClick={() => void refresh()}>
            {t('settings.github.recheck')}
          </button>
        </SettingRow>
      );
    }
    if (status.loggedIn && status.tokenSource === 'env') {
      const name = status.envTokenVar ?? 'GH_TOKEN';
      return (
        <SettingRow
          title={
            status.user === null
              ? t('settings.github.envTokenLoggedInNoUser', { name })
              : t('settings.github.envTokenLoggedIn', { user: status.user, name })
          }
        >
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => void connect()}
          >
            {t(phase === 'starting' ? 'settings.github.starting' : 'settings.github.connect')}
          </button>
        </SettingRow>
      );
    }
    if (status.loggedIn) {
      const title =
        status.user === null
          ? t('settings.github.loggedInNoUser')
          : t('settings.github.loggedIn', { user: status.user });
      return (
        <SettingRow
          title={title}
          {...(status.scopes
            ? { description: t('settings.github.scopes', { scopes: status.scopes.join(', ') }) }
            : {})}
        >
          <button
            type="button"
            className="btn btn-sm"
            disabled={disconnecting}
            onClick={() => setConfirming(true)}
          >
            {t(disconnecting ? 'settings.github.disconnecting' : 'settings.github.disconnect')}
          </button>
        </SettingRow>
      );
    }
    return (
      <SettingRow title={t('settings.github.loggedOut')}>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy}
          onClick={() => void connect()}
        >
          {t(phase === 'starting' ? 'settings.github.starting' : 'settings.github.connect')}
        </button>
      </SettingRow>
    );
  };

  return (
    <>
      <SettingGroup
        title={t('settings.github.group')}
        description={t('settings.github.description')}
      >
        {statusRow()}
        {status?.envTokenVar ? (
          <p className="library-warning" role="status">
            {t('settings.github.envToken', { name: status.envTokenVar })}
          </p>
        ) : null}
        {phase === 'waiting-code' ? (
          <p className="setting-row-desc" role="status">
            {t('settings.github.waitingCode')}
          </p>
        ) : null}
        {device ? (
          <div className="github-device" role="status">
            <span className="github-device-label">{t('settings.github.codeLabel')}</span>
            <code className="github-device-code mono">{device.code}</code>
            <p className="setting-row-desc">{t('settings.github.validate')}</p>
            <div className="github-device-actions">
              <button type="button" className="btn btn-sm" onClick={() => void copyCode()}>
                {t(copied ? 'settings.github.codeCopied' : 'settings.github.copyCode')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => void window.inova.openExternalUrl({ url: device.url })}
              >
                {t('settings.github.openGithub')}
              </button>
            </div>
          </div>
        ) : null}
        {phase === 'waiting-code' || phase === 'code' ? (
          <div className="github-device-actions">
            <button type="button" className="btn btn-sm" onClick={() => void cancel()}>
              {t('settings.github.cancel')}
            </button>
          </div>
        ) : null}
        {error ? (
          <p className="library-error" role="alert">
            {t('settings.github.failed', { message: error })}
          </p>
        ) : null}
      </SettingGroup>
      {confirming ? (
        <ConfirmModal
          title={t('settings.github.confirmTitle')}
          description={t('settings.github.confirmDescription', { user: status?.user ?? 'GitHub' })}
          confirmLabel={t('settings.github.disconnect')}
          danger
          onConfirm={() => void disconnect()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
