import { useCallback, useEffect, useState } from 'react';
import type { CapabilityItem, CapabilityListing } from '../shared/api';
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

  const store = useCallback(
    (next: CapabilityListing) => {
      listingCache.set(accountLabel, next);
      setListing(next);
    },
    [accountLabel],
  );

  const refresh = useCallback(async () => {
    const loaded = await call(() => window.inova.listCapabilities({ accountLabel }));
    if (loaded) store(loaded.value);
  }, [accountLabel, call, store]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void refresh().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  const toggle = useCallback(
    async (input: { item: CapabilityItem; enabled: boolean }) => {
      const { item, enabled } = input;
      setPendingKey(capabilityKey(item));
      try {
        const updated = await call(() =>
          window.inova.setCapabilityEnabled({
            accountLabel,
            kind: item.kind,
            id: item.id,
            enabled,
          }),
        );
        if (updated) store(updated.value);
        else await refresh();
      } finally {
        setPendingKey(null);
      }
    },
    [accountLabel, call, refresh, store],
  );

  return { listing, loading, pendingKey, toggle };
}
