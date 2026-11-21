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

describe('createBasemapEnsurer progress and notify', () => {
  it('reports clamped progress while a download runs and clears it after', async () => {
    let finish: () => void = () => {};
    const { ensure, progress, subscribe } = createBasemapEnsurer(
      (_url, report) =>
        new Promise<number>((resolve) => {
          report(0.25);
          report(7);
          finish = () => resolve(1);
        }),
    );
    const cb = vi.fn();
    subscribe(cb);
    const run = ensure('u');
    expect(progress('u')).toBe(1);
    expect(progress('other')).toBeNull();
    expect(cb).toHaveBeenCalledTimes(2);
    finish();
    await run;
    expect(progress('u')).toBeNull();
  });

  it('tells subscribers only when a whole percent changes', () => {
    const { ensure, subscribe } = createBasemapEnsurer(
      (_url, report) =>
        new Promise<number>(() => {
          report(0.251);
          report(0.255);
          report(0.259);
          report(0.26);
        }),
    );
    const cb = vi.fn();
    subscribe(cb);
    void ensure('u');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('notify runs the subscribers without a download', () => {
    const { notify, subscribe } = createBasemapEnsurer(async () => 0);
    const cb = vi.fn();
    subscribe(cb);
    notify();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
