import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings, SettingsPatch } from '@inova/core/types';
import { applySettingsPatch, inverseSettingsPatch } from './settings-state';
import type { WarningCall } from './useWarning';

export function useSettings(call: WarningCall) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const settingsRef = useRef<Settings | null>(null);

  const commit = useCallback((next: Settings) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  useEffect(() => {
    void call(() => window.inova.getSettings()).then((loaded) => {
      if (loaded) commit(loaded.value);
    });
  }, [call, commit]);

  const update = useCallback(
    async (patch: SettingsPatch) => {
      const current = settingsRef.current;
      if (current === null) return;
      const undo = inverseSettingsPatch(current, patch);
      commit(applySettingsPatch(current, patch));
      const saved = await call(() => window.inova.updateSettings(patch));
      const latest = settingsRef.current;
      if (!saved && latest !== null) commit(applySettingsPatch(latest, undo));
    },
    [call, commit],
  );

  return { settings, update };
}
