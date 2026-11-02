import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setAuthToken, ApiClientError } from '../api';
import { runSpotifyBackfill, uploadSiteplanImage } from '../adminFestivalTools';

const res = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAuthToken(null);
});

describe('runSpotifyBackfill', () => {
  it('posts the body and uses a 120 s timeout', async () => {
    const spy = vi.fn(async () => res(200, { data: { updated: 1, skipped: 0, total: 1, unmatched: [] }, error: null }));
    vi.stubGlobal('fetch', spy);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const out = await runSpotifyBackfill('f 1', { setIds: ['s'], force: true });
    expect(out.updated).toBe(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/admin/festivals/f%201/backfill-spotify');
    expect(init.body).toBe(JSON.stringify({ setIds: ['s'], force: true }));
    expect(timeoutSpy.mock.calls.some((c) => c[1] === 120_000)).toBe(true);
  });
});

describe('uploadSiteplanImage', () => {
  beforeEach(() => setAuthToken('tok'));

  it('sends FormData field image with bearer headers and unwraps data', async () => {
    const spy = vi.fn(async () => res(201, { data: { imageUrl: 'https://x/y.webp' }, error: null }));
    vi.stubGlobal('fetch', spy);
    const out = await uploadSiteplanImage('f1', new Blob(['a'], { type: 'image/png' }));
    expect(out).toEqual({ imageUrl: 'https://x/y.webp' });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/admin/festivals/f1/siteplan-image');
    expect((init.body as FormData).get('image')).toBeInstanceOf(Blob);
    const h = init.headers as Record<string, string>;
    expect(h['Authorization']).toBe('Bearer tok');
    expect(h['X-Festie-Client']).toBe('native');
    expect(init.credentials).toBe('omit');
  });

  it('throws the server message on 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(400, { data: null, error: { message: 'The image must be 10 MB or smaller.', code: 'INVALID_INPUT' } }),
      ),
    );
    const err = await uploadSiteplanImage('f1', new Blob(['a'])).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.message).toBe('The image must be 10 MB or smaller.');
    expect(err.status).toBe(400);
  });
});
