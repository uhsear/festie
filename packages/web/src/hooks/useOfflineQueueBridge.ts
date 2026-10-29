import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from '@festie/shared/services';
import { useOfflineQueue } from './useOfflineQueue';

const CREW_LIST_KEYS: Record<string, string[]> = {
  expenses: ['expenses', 'expense-balances', 'settlement-plan'],
  polls: ['polls'],
  'meeting-points': ['meeting-points'],
};

/** Query keys of the crew lists a replayed write to `url` changed ([] for other URLs). */
export function queryKeysForSentUrl(url: string): QueryKey[] {
  const m = /\/crews\/([^/?]+)\/([^/?]+)/.exec(url);
  if (!m) return [];
  return (CREW_LIST_KEYS[m[2]!] ?? []).map((key) => [key, m[1]!]);
}

/**
 * Sets up the global `window.__festieQueue` bridge so any component
 * (savePick, RatingButtons, etc.) can queue offline mutations.
 * Also auto-drains the queue on `online` events and on mount.
 */
export function useOfflineQueueBridge() {
  const { queueMutation, processQueue } = useOfflineQueue();
  const queryClient = useQueryClient();

  useEffect(() => {
    // Adapter: api.* helpers take (path, body) not (path, {method, body}).
    const adapter = async (
      url: string,
      init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
    ) => {
      const m = (init.method || 'POST').toUpperCase();
      const opts = init.idempotencyKey ? { headers: { 'Idempotency-Key': init.idempotencyKey } } : {};
      if (m === 'GET')    return api.get(url, opts);
      if (m === 'PUT')    return api.put(url, init.body, opts);
      if (m === 'PATCH')  return api.patch(url, init.body, opts);
      if (m === 'DELETE') return api.delete(url, opts);
      return api.post(url, init.body, opts);
    };
    // Clear "Not sent yet" rows as soon as the write lands, not at the next refetch.
    const onSent = ({ url }: { url: string; method: string }) => {
      for (const queryKey of queryKeysForSentUrl(url)) void queryClient.invalidateQueries({ queryKey });
    };
    window.__festieQueue = {
      queueMutation: queueMutation as (args: unknown) => Promise<unknown>,
      processQueue: () => processQueue(adapter, undefined, onSent),
    };
    const onOnline = () => { processQueue(adapter, undefined, onSent).catch(() => {}); };
    window.addEventListener('online', onOnline);
    // Also drain on mount (covers the case where we boot online with queued items)
    if (navigator.onLine) processQueue(adapter, undefined, onSent).catch(() => {});
    return () => { window.removeEventListener('online', onOnline); };
  }, [queueMutation, processQueue, queryClient]);
}
