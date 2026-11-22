import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { basemapCacheInfo, basemapProgress, basemapSize, ensureBasemapCached, removeBasemap, subscribeBasemapCache } from './basemapCache';

const URL1 = 'https://cdn.example.com/a.pmtiles';

function fakeCaches(initialKeys: string[] = []) {
  const store = new Map<string, Response>(initialKeys.map((k) => [k, new Response('x')]));
  const cache = {
    match: vi.fn(async (u: string) => store.get(u)),
    put: vi.fn(async (u: string, r: Response) => void store.set(u, r)),
    keys: vi.fn(async () => [...store.keys()].map((u) => ({ url: u }))),
    delete: vi.fn(async (req: { url: string } | string) => store.delete(typeof req === 'string' ? req : req.url)),
  };
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
  return { store, cache };
}

describe('basemapCache', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { storage: { estimate: vi.fn(async () => ({ quota: 1e9, usage: 0 })), persist: vi.fn() } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads cached state and the Date header from the cache', async () => {
    const { store } = fakeCaches();
    expect(await basemapCacheInfo(URL1)).toEqual({ cached: false, syncedAt: null });
    store.set(URL1, new Response('x', { headers: { date: 'Sun, 01 Nov 2026 12:00:00 GMT' } }));
    expect(await basemapCacheInfo(URL1)).toEqual({ cached: true, syncedAt: Date.parse('2026-11-01T12:00:00Z') });
  });

  it('basemapSize returns Content-Length, or null on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { headers: { 'content-length': '5000' } })));
    expect(await basemapSize(URL1)).toBe(5000);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await basemapSize(URL1)).toBeNull();
  });

  it('returns quota without fetching the body when free space is below the size', async () => {
    fakeCaches();
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 1000, usage: 900 }) } });
    const fetchMock = vi.fn(async () => new Response(null, { headers: { 'content-length': '5000' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await ensureBasemapCached(URL1)).toEqual({ ok: false, reason: 'quota', bytes: 5000, freeBytes: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps QuotaExceededError on put to quota and other errors to network', async () => {
    const { cache } = fakeCaches();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('body')));
    cache.put.mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    expect(await ensureBasemapCached(URL1)).toMatchObject({ ok: false, reason: 'quota' });
    cache.put.mockRejectedValueOnce(new Error('boom'));
    expect(await ensureBasemapCached(URL1)).toMatchObject({ ok: false, reason: 'network' });
  });

  it('returns network for a 404', async () => {
    fakeCaches();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    expect(await ensureBasemapCached(URL1)).toMatchObject({ ok: false, reason: 'network' });
  });

  it('stores the archive, requests persistence, and drops the oldest past 3', async () => {
    const { store, cache } = fakeCaches(['https://e.com/1.pmtiles', 'https://e.com/2.pmtiles', 'https://e.com/3.pmtiles']);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('body')));
    expect(await ensureBasemapCached(URL1)).toEqual({ ok: true });
    expect(cache.put).toHaveBeenCalledWith(URL1, expect.any(Response));
    expect(store.has('https://e.com/1.pmtiles')).toBe(false);
    expect(store.size).toBe(3);
    expect(navigator.storage.persist).toHaveBeenCalled();
  });

  it('joins a second call for the same URL to the first', async () => {
    fakeCaches();
    const fetchMock = vi.fn(async () => new Response('body'));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([ensureBasemapCached(URL1), ensureBasemapCached(URL1)]);
    expect(a).toEqual(b);
    // one HEAD + one GET for a single download
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports download progress from the streamed body and stores every byte', async () => {
    const { store, cache } = fakeCaches();
    // A real cache reads the whole body while storing it; the fake must too.
    cache.put.mockImplementationOnce(async (u: string, r: Response) => void store.set(u, new Response(await r.arrayBuffer())));
    const seen: Array<number | null> = [];
    const off = subscribeBasemapCache(() => seen.push(basemapProgress(URL1)));
    const chunks = [new Uint8Array(40), new Uint8Array(60)];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((c) => controller.enqueue(c));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: { method?: string }) =>
        init?.method === 'HEAD'
          ? new Response(null, { headers: { 'content-length': '100' } })
          : new Response(body, { headers: { 'content-length': '100' } }),
      ),
    );
    expect(await ensureBasemapCached(URL1)).toEqual({ ok: true });
    off();
    expect(seen).toContain(0.4);
    expect(seen).toContain(1);
    expect(basemapProgress(URL1)).toBeNull();
    expect((await store.get(URL1)!.arrayBuffer()).byteLength).toBe(100);
  });

  it('removes a downloaded archive and tells subscribers', async () => {
    const { store } = fakeCaches([URL1]);
    const cb = vi.fn();
    const off = subscribeBasemapCache(cb);
    expect(await removeBasemap(URL1)).toBe(true);
    expect(store.has(URL1)).toBe(false);
    expect(cb).toHaveBeenCalled();
    expect(await removeBasemap(URL1)).toBe(false);
    off();
  });
});
