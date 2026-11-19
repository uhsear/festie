// Web mirror of mobile lib/basemapCache. Stores a festival's whole PMTiles
// archive in the Cache API under OFFLINE_MAP_CACHE, where the service worker's
// rangeRequests rule serves it offline. Readiness is read from the cache on
// every call, never remembered, because the browser can evict it.
import { OFFLINE_MAP_CACHE } from '@festie/shared/pwa/runtimeCaching';
import { createBasemapEnsurer, headContentLength } from '@festie/shared/utils';

export type EnsureResult = { ok: true } | { ok: false; reason: 'quota' | 'network'; bytes: number | null };

const MAX_ARCHIVES = 3;

export function basemapSupported(): boolean {
  return typeof caches !== 'undefined';
}

export async function basemapCacheInfo(url: string): Promise<{ cached: boolean; syncedAt: number | null }> {
  try {
    const res = await (await caches.open(OFFLINE_MAP_CACHE)).match(url);
    if (!res) return { cached: false, syncedAt: null };
    const date = Date.parse(res.headers.get('date') ?? '');
    return { cached: true, syncedAt: Number.isNaN(date) ? null : date };
  } catch {
    return { cached: false, syncedAt: null };
  }
}

export const basemapSize = headContentLength;

async function downloadOnce(url: string): Promise<EnsureResult> {
  const bytes = await basemapSize(url);
  try {
    const est = await navigator.storage?.estimate?.();
    if (bytes !== null && est?.quota != null && est.usage != null && est.quota - est.usage < bytes) {
      return { ok: false, reason: 'quota', bytes };
    }
    const res = await fetch(url);
    if (!res.ok) return { ok: false, reason: 'network', bytes };
    const cache = await caches.open(OFFLINE_MAP_CACHE);
    await cache.put(url, res);
    const keys = await cache.keys();
    // shortcut: drops the oldest archive past 3, upgrade to an LRU if users keep more festivals
    if (keys.length > MAX_ARCHIVES && keys[0]) await cache.delete(keys[0]);
    void navigator.storage?.persist?.();
    return { ok: true };
  } catch (err) {
    const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
    return { ok: false, reason: quota ? 'quota' : 'network', bytes };
  }
}

const ensurer = createBasemapEnsurer(downloadOnce);

/** Runs after any archive attempt settles, so every mounted download hook re-reads the cache. */
export const subscribeBasemapCache = ensurer.subscribe;
export const ensureBasemapCached = ensurer.ensure;
