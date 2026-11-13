import { useEffect } from 'react';
import type { ThemePreference } from '@inova/core/types';
import { applyTheme, resolveTheme } from './theme';

export function useTheme(preference: ThemePreference | undefined): void {
  useEffect(() => {
    if (preference === undefined) return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => applyTheme(resolveTheme(preference, query.matches));
    apply();
    if (preference !== 'system') return;
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [preference]);
}
