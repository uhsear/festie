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
 * A download may call `report(fraction)` (0 to 1) while it runs; subscribers run on each
 * report and `progress(url)` reads the latest value (null when nothing is running).
 * `notify()` runs the subscribers after a change made outside a download, such as a delete.
 */
export function createBasemapEnsurer<T>(download: (url: string, report: (fraction: number) => void) => Promise<T>) {
  const inFlight = new Map<string, Promise<T>>();
  const progress = new Map<string, number>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((cb) => cb());
  return {
    ensure(url: string): Promise<T> {
      const existing = inFlight.get(url);
      if (existing) return existing;
      const report = (fraction: number) => {
        progress.set(url, Math.min(1, Math.max(0, fraction)));
        notify();
      };
      const run = download(url, report).finally(() => {
        inFlight.delete(url);
        progress.delete(url);
        notify();
      });
      inFlight.set(url, run);
      return run;
    },
    progress(url: string): number | null {
      return progress.get(url) ?? null;
    },
    notify,
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
