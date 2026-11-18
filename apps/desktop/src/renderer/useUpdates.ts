import { useCallback, useEffect, useState } from 'react';
import type { UpdateInfo, UpdateInstallStage } from '../shared/api';
import {
  LAST_SEEN_VERSION_KEY,
  UPDATE_DISMISSED_KEY,
  manualCheckStatus,
  shouldShowUpdateToast,
  shouldShowWhatsNew,
} from './update-state';
import type { WarningCall } from './useWarning';

export function useUpdates(call: WarningCall) {
  const [version, setVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installStage, setInstallStage] = useState<UpdateInstallStage | null>(null);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(UPDATE_DISMISSED_KEY));
  const [changelog, setChangelog] = useState<{ whatsNew: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    void window.inova.getAppInfo().then((result) => {
      if (!active || !result.ok) return;
      const current = result.value.version;
      setVersion(current);
      const lastSeen = localStorage.getItem(LAST_SEEN_VERSION_KEY);
      if (shouldShowWhatsNew({ lastSeen, current })) setChangelog({ whatsNew: true });
      localStorage.setItem(LAST_SEEN_VERSION_KEY, current);
    });
    void window.inova.checkForUpdate().then((result) => {
      if (active && result.ok) setInfo(result.value);
    });
    const unsubscribeAvailable = window.inova.onUpdateAvailable(setInfo);
    const unsubscribeProgress = window.inova.onUpdateProgress(setInstallStage);
    return () => {
      active = false;
      unsubscribeAvailable();
      unsubscribeProgress();
    };
  }, []);

  const dismissToast = useCallback(() => {
    if (!info?.latest) return;
    localStorage.setItem(UPDATE_DISMISSED_KEY, info.latest);
    setDismissed(info.latest);
  }, [info]);

  const checkNow = useCallback(async () => {
    const result = await window.inova.checkForUpdate();
    if (result.ok) setInfo(result.value);
    return manualCheckStatus(result);
  }, []);

  const install = useCallback(async () => {
    setInstalling(true);
    setInstallStage(null);
    const result = await call(() => window.inova.installUpdate());
    if (!result) {
      setInstalling(false);
      setInstallStage(null);
    }
  }, [call]);

  return {
    version,
    info,
    installing,
    installStage,
    install,
    checkNow,
    updateAvailable: info?.available === true,
    toastVisible: shouldShowUpdateToast({ info, dismissed }),
    dismissToast,
    changelog,
    openChangelog: useCallback(() => setChangelog({ whatsNew: false }), []),
    closeChangelog: useCallback(() => setChangelog(null), []),
  };
}
