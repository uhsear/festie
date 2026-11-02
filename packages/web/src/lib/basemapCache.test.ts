import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { basemapCacheInfo, basemapSize, ensureBasemapCached } from './basemapCache';

const URL1 = 'https://cdn.example.com/a.pmtiles';

function fakeCaches(initialKeys: string[] = []) {
  const store = new Map<string, Response>(initialKeys.map((k) => [k, new Response('x')]));
  const cache = {
    match: vi.fn(async (u: string) => store.get(u)),
    put: vi.fn(async (u: string, r: Response) => void store.set(u, r)),
    keys: vi.fn(async () => [...store.keys()].map((u) => ({ url: u }))),
    delete: vi.fn(async (req: { url: string }) => store.delete(req.url)),
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
    expect(await ensureBasemapCached(URL1)).toEqual({ ok: false, reason: 'quota', bytes: 5000 });
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
});
