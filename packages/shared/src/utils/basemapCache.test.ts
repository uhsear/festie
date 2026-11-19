import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBasemapEnsurer, headContentLength } from './basemapCache';

afterEach(() => vi.unstubAllGlobals());

describe('headContentLength', () => {
  it('returns Content-Length from a HEAD', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { headers: { 'content-length': '5000' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await headContentLength('https://x/a.pmtiles')).toBe(5000);
    expect(fetchMock).toHaveBeenCalledWith('https://x/a.pmtiles', { method: 'HEAD' });
  });

  it('returns null for a missing length, a non-ok response, or a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null)));
    expect(await headContentLength('u')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500, headers: { 'content-length': '9' } })));
    expect(await headContentLength('u')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await headContentLength('u')).toBeNull();
  });
});

describe('createBasemapEnsurer', () => {
  it('shares one in-flight download per URL, then notifies and allows a new run', async () => {
    const download = vi.fn(async (u: string) => u.length);
    const { ensure, subscribe } = createBasemapEnsurer(download);
    const cb = vi.fn();
    const off = subscribe(cb);
    const [a, b] = [ensure('abc'), ensure('abc')];
    expect(a).toBe(b);
    expect(await a).toBe(3);
    expect(download).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledTimes(1);
    await ensure('abc');
    expect(download).toHaveBeenCalledTimes(2);
    off();
    await ensure('abc');
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
