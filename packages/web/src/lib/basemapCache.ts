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

/** Counts the bytes of a response body as the cache reads it, so the card can show a percentage. */
function withProgress(res: Response, total: number | null, report: (fraction: number) => void): Response {
  if (!res.body || !total) return res;
  const reader = res.body.getReader();
  let loaded = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      loaded += value.byteLength;
      report(loaded / total);
      controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function downloadOnce(url: string, report: (fraction: number) => void): Promise<EnsureResult> {
  const bytes = await basemapSize(url);
  try {
    const est = await navigator.storage?.estimate?.();
    if (bytes !== null && est?.quota != null && est.usage != null && est.quota - est.usage < bytes) {
      return { ok: false, reason: 'quota', bytes };
    }
    const res = await fetch(url);
    if (!res.ok) return { ok: false, reason: 'network', bytes };
    const cache = await caches.open(OFFLINE_MAP_CACHE);
    await cache.put(url, withProgress(res, bytes, report));
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
/** Fraction (0 to 1) of the running download of this archive, or null when none is running. */
export const basemapProgress = ensurer.progress;

/** Delete a festival's downloaded archive. Returns whether one was removed. */
export async function removeBasemap(url: string): Promise<boolean> {
  try {
    return await (await caches.open(OFFLINE_MAP_CACHE)).delete(url);
  } catch {
    return false;
  } finally {
    ensurer.notify();
  }
}
