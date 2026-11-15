import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import type { SupportedLocale } from '@inova/core/types';
import { translate, type TranslationKey } from './i18n';

interface I18nContextValue {
  locale: SupportedLocale;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'pt-BR',
  t: (key, params) => translate('pt-BR', key, params),
});

export function I18nProvider({
  locale,
  children,
}: {
  locale: SupportedLocale;
  children: ReactNode;
}) {
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  );

  return <I18nContext.Provider value={{ locale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
