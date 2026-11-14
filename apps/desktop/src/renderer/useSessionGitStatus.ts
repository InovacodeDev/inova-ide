import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorktreeStatusView } from '../shared/api';

export interface SessionGitStatusState {
  status: WorktreeStatusView | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSessionGitStatus(input: {
  sessionId: string;
  running?: boolean;
  revision?: number;
}): SessionGitStatusState {
  const { sessionId, running = false, revision = 0 } = input;
  const [status, setStatus] = useState<WorktreeStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);
  const inflightRef = useRef(false);
  const pendingRef = useRef(false);
  const activeSessionRef = useRef(sessionId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeSessionRef.current = sessionId;
  }, [sessionId]);

  const load = useCallback(async (): Promise<void> => {
    if (typeof window === 'undefined' || typeof window.inova?.getWorktreeStatus !== 'function') {
      return;
    }
    if (inflightRef.current) {
      pendingRef.current = true;
      return;
    }
    const requestedSessionId = sessionId;
    inflightRef.current = true;
    setLoading(true);
    try {
      const result = await window.inova.getWorktreeStatus({ sessionId: requestedSessionId });
      if (!aliveRef.current || activeSessionRef.current !== requestedSessionId) return;
      if (result.ok) {
        setStatus(result.value);
        setError(null);
      } else {
        setStatus(null);
        setError(result.message);
      }
    } catch (failure: unknown) {
      if (!aliveRef.current || activeSessionRef.current !== requestedSessionId) return;
      console.error('inova: failed to load session git status', failure);
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
    timerRef.current = setTimeout(() => void load(), 0);
    return cancelTimer;
  }, [sessionId, running, revision, load, cancelTimer]);

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

  return { status, loading, error, refresh };
}
