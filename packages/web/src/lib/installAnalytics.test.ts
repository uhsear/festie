import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installPlatform, postInstallEvent } from './installAnalytics';

describe('installPlatform', () => {
  it('detects ios, android and desktop', () => {
    expect(installPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('ios');
    expect(installPlatform('Mozilla/5.0 (Linux; Android 14)')).toBe('android');
    expect(installPlatform('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBe('desktop');
  });
});

describe('postInstallEvent', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('posts shown once across two calls, then accepted', () => {
    postInstallEvent('shown');
    postInstallEvent('shown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    postInstallEvent('accepted');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends a JSON body with the content type set', () => {
    postInstallEvent('dismissed');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/analytics/install');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ platform: 'desktop', event: 'dismissed' });
  });
});
