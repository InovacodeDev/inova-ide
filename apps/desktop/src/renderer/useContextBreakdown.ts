import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextBreakdown } from '@inova/core/chat-types';

const AUTO_REFRESH_DEBOUNCE_MS = 1500;

export interface ContextBreakdownState {
  breakdown: ContextBreakdown | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

export function useContextBreakdown(input: {
  sessionId: string;
  usedTokens: number | null;
}): ContextBreakdownState {
  const { sessionId, usedTokens } = input;
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);
  const inflightRef = useRef(false);
  const pendingRef = useRef(false);
  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (inflightRef.current) {
      pendingRef.current = true;
      return;
    }
    inflightRef.current = true;
    setLoading(true);
    try {
      const result = await window.inova.getContextBreakdown({ sessionId });
      if (!aliveRef.current) return;
      loadedRef.current = true;
      if (result.ok) {
        setBreakdown(result.value);
        setError(null);
      } else {
        setError(result.message);
      }
    } catch (failure: unknown) {
      if (!aliveRef.current) return;
      console.error('inova: failed to load context breakdown', failure);
      setError('Erro inesperado.');
    } finally {
      inflightRef.current = false;
      if (aliveRef.current) setLoading(false);
    }
    if (aliveRef.current && pendingRef.current) {
      pendingRef.current = false;
      await load();
    }
  }, [sessionId]);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    const delay = loadedRef.current ? AUTO_REFRESH_DEBOUNCE_MS : 0;
    timerRef.current = setTimeout(() => void load(), delay);
    return cancelTimer;
  }, [usedTokens, load, cancelTimer]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    cancelTimer();
    void load();
  }, [cancelTimer, load]);

  return { breakdown, error, loading, refresh };
}
