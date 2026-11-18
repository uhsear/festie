import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setAuthToken, ApiClientError } from '../api';
import { uploadSiteplanImage } from '../adminFestivalTools';

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
