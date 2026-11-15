import { useCallback, useEffect, useRef, useState } from 'react';
import type { CapabilityItem, CapabilityListing } from '../shared/api';
import { shouldApplyListing } from './capabilities-state';
import type { WarningCall } from './useWarning';

const listingCache = new Map<string, CapabilityListing>();

export function capabilityKey(item: Pick<CapabilityItem, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`;
}

export function useCapabilities(input: { accountLabel: string; call: WarningCall }) {
  const { accountLabel, call } = input;
  const [listing, setListing] = useState<CapabilityListing | null>(
    () => listingCache.get(accountLabel) ?? null,
  );
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const store = useCallback(
    (requestId: number, next: CapabilityListing) => {
      const apply = shouldApplyListing({
        requestId,
        latestRequestId: latestRequest.current,
        mounted: mounted.current,
      });
      if (!apply) return;
      listingCache.set(accountLabel, next);
      setListing(next);
    },
    [accountLabel],
  );

  const refresh = useCallback(async () => {
    latestRequest.current += 1;
    const requestId = latestRequest.current;
    const loaded = await call(() => window.inova.listCapabilities({ accountLabel }));
    if (loaded) store(requestId, loaded.value);
  }, [accountLabel, call, store]);

  useEffect(() => {
    setListing(listingCache.get(accountLabel) ?? null);
    setPendingKey(null);
    setLoading(true);
    void refresh().finally(() => {
      if (mounted.current) setLoading(false);
    });
    return () => {
      latestRequest.current += 1;
    };
  }, [accountLabel, refresh]);

  const toggle = useCallback(
    async (input: { item: CapabilityItem; enabled: boolean }) => {
      if (pendingKey !== null) return;
      const { item, enabled } = input;
      setPendingKey(capabilityKey(item));
      latestRequest.current += 1;
      const requestId = latestRequest.current;
      let current = false;
      try {
        const updated = await call(() =>
          window.inova.setCapabilityEnabled({
            accountLabel,
            kind: item.kind,
            id: item.id,
            enabled,
          }),
        );
        current = shouldApplyListing({
          requestId,
          latestRequestId: latestRequest.current,
          mounted: mounted.current,
        });
        if (!current) return;
        if (updated) store(requestId, updated.value);
        else await refresh();
      } finally {
        if (current) setPendingKey(null);
      }
    },
    [accountLabel, call, pendingKey, refresh, store],
  );

  return { listing, loading, pendingKey, toggle };
}
