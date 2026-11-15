import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupportedLocale } from '@inova/core/types';
import type { Result } from '../shared/api';
import { translate } from './i18n';

const WARNING_MS = 6000;
export const WARNING_HISTORY_LIMIT = 20;

export interface WarningEntry {
  id: number;
  message: string;
  at: string;
}

export function appendWarningEntry(
  history: readonly WarningEntry[],
  entry: WarningEntry,
): WarningEntry[] {
  return [entry, ...history].slice(0, WARNING_HISTORY_LIMIT);
}

export type WarningCall = <T>(
  action: () => Promise<Result<T>>,
) => Promise<{ value: T } | undefined>;

export function useWarning(locale: SupportedLocale = 'pt-BR') {
  const [current, setCurrent] = useState<{ id: number; message: string } | null>(null);
  const [history, setHistory] = useState<WarningEntry[]>([]);
  const nextId = useRef(0);
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const setWarning = useCallback((message: string | null) => {
    if (message === null) {
      setCurrent(null);
      return;
    }
    nextId.current += 1;
    const entry: WarningEntry = {
      id: nextId.current,
      message,
      at: new Date().toISOString(),
    };
    setCurrent({ id: entry.id, message: entry.message });
    setHistory((prev) => appendWarningEntry(prev, entry));
  }, []);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setCurrent(null), WARNING_MS);
    return () => clearTimeout(timer);
  }, [current]);

  const guard = useCallback(
    async <T>(action: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await action();
      } catch (error: unknown) {
        console.error('inova: unexpected renderer error', error);
        setWarning(translate(localeRef.current, 'alerts.unexpected'));
        return undefined;
      }
    },
    [setWarning],
  );

  const call = useCallback(
    async <T>(action: () => Promise<Result<T>>): Promise<{ value: T } | undefined> => {
      const result = await guard(action);
      if (!result) return undefined;
      if (!result.ok) {
        setWarning(result.message);
        return undefined;
      }
      return { value: result.value };
    },
    [guard, setWarning],
  );

  const dismiss = useCallback(() => setWarning(null), [setWarning]);
  const clearHistory = useCallback(() => setHistory([]), []);
  const setLocale = useCallback((next: SupportedLocale) => {
    localeRef.current = next;
  }, []);

  return {
    warning: current?.message ?? null,
    history,
    dismiss,
    clearHistory,
    setLocale,
    guard,
    call,
    warn: setWarning,
  };
}
