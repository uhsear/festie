// Offline basemap cache logic shared by web (Cache API) and mobile (file system).
// Each platform supplies only its storage-specific download step.

/** Expected byte length from a HEAD, or null when the server does not say or the request fails. */
export async function headContentLength(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length'));
    return Number.isFinite(len) && len > 0 ? len : null;
  } catch {
    return null;
  }
}

/**
 * Runs one download per URL at a time: concurrent callers await the same promise.
 * Subscribers run after any attempt settles, so mounted hooks re-read the cache.
 */
export function createBasemapEnsurer<T>(download: (url: string) => Promise<T>) {
  const inFlight = new Map<string, Promise<T>>();
  const listeners = new Set<() => void>();
  return {
    ensure(url: string): Promise<T> {
      const existing = inFlight.get(url);
      if (existing) return existing;
      const run = download(url).finally(() => {
        inFlight.delete(url);
        listeners.forEach((cb) => cb());
      });
      inFlight.set(url, run);
      return run;
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
