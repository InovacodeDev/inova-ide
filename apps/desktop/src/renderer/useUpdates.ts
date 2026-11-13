import { useCallback, useEffect, useState } from 'react';
import type { UpdateInfo } from '../shared/api';
import {
  LAST_SEEN_VERSION_KEY,
  UPDATE_DISMISSED_KEY,
  shouldShowUpdateToast,
  shouldShowWhatsNew,
} from './update-state';

export function useUpdates() {
  const [version, setVersion] = useState<string | null>(null);
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
    const unsubscribe = window.inova.onUpdateAvailable(setInfo);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const dismissToast = useCallback(() => {
    if (!info?.latest) return;
    localStorage.setItem(UPDATE_DISMISSED_KEY, info.latest);
    setDismissed(info.latest);
  }, [info]);

  return {
    version,
    info,
    updateAvailable: info?.available === true,
    toastVisible: shouldShowUpdateToast({ info, dismissed }),
    dismissToast,
    changelog,
    openChangelog: useCallback(() => setChangelog({ whatsNew: false }), []),
    closeChangelog: useCallback(() => setChangelog(null), []),
  };
}
