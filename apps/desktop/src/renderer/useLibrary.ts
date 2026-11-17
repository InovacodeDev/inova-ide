import { useCallback, useEffect, useState } from 'react';
import type { LibraryListing, Result } from '../shared/api';
import { translate, type SupportedLocale } from './i18n';

export async function libraryCall<T>(input: {
  action: () => Promise<Result<T>>;
  locale: SupportedLocale;
}): Promise<Result<T>> {
  try {
    return await input.action();
  } catch (error: unknown) {
    console.error('inova: unexpected library error', error);
    return { ok: false, message: translate(input.locale, 'alerts.unexpected') };
  }
}

export interface LibraryState {
  listing: LibraryListing | null;
  loadError: string | null;
  reload: () => Promise<void>;
}

export function useLibrary(locale: SupportedLocale): LibraryState {
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await libraryCall({ action: () => window.inova.listLibrary(), locale });
    if (result.ok) {
      setListing(result.value);
      setLoadError(null);
    } else {
      setLoadError(result.message);
    }
  }, [locale]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { listing, loadError, reload };
}
