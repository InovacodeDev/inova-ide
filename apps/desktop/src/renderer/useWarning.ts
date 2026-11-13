import { useCallback, useEffect, useRef, useState } from 'react';
import type { Result } from '../shared/api';

const WARNING_MS = 6000;

export type WarningCall = <T>(
  action: () => Promise<Result<T>>,
) => Promise<{ value: T } | undefined>;

export function useWarning() {
  const [current, setCurrent] = useState<{ id: number; message: string } | null>(null);
  const nextId = useRef(0);

  const setWarning = useCallback((message: string | null) => {
    nextId.current += 1;
    setCurrent(message === null ? null : { id: nextId.current, message });
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
        setWarning('Erro inesperado.');
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

  return { warning: current?.message ?? null, dismiss, guard, call };
}
