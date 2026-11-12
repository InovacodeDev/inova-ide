import { useCallback, useEffect, useState } from 'react';
import type { Result } from '../shared/api';

const WARNING_MS = 6000;

export function useWarning() {
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(null), WARNING_MS);
    return () => clearTimeout(timer);
  }, [warning]);

  const guard = useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setWarning(`Erro inesperado: ${message}`);
      return undefined;
    }
  }, []);

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
    [guard],
  );

  const dismiss = useCallback(() => setWarning(null), []);

  return { warning, dismiss, guard, call };
}
