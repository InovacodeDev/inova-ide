import type { ThemePreference } from '@inova/core/types';

export type ResolvedTheme = 'dark' | 'light';

const CACHE_KEY = 'inova:theme';

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersLight: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersLight ? 'light' : 'dark';
  return preference;
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset['theme'] = theme;
  try {
    localStorage.setItem(CACHE_KEY, theme);
  } catch {
    return;
  }
}

// NOTE: settings load over IPC after first paint; the cached value avoids a dark flash for
// light-theme users on startup.
export function applyCachedTheme(): void {
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(CACHE_KEY);
  } catch {
    cached = null;
  }
  document.documentElement.dataset['theme'] = cached === 'light' ? 'light' : 'dark';
}
