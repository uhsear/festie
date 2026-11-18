import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('html-to-image', () => ({ toBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }));

import { sharePoster, wrapShareLink } from './sharePoster';

describe('wrapShareLink', () => {
  it('builds the festival page link tagged share-wrap', () => {
    expect(wrapShareLink('edc-orlando-2026', 'EDC Orlando')).toEqual({
      text: 'EDC Orlando lineup and set times on Festie',
      url: `${window.location.origin}/f/edc-orlando-2026?ref=share-wrap`,
    });
  });

  it('returns undefined without a slug', () => {
    expect(wrapShareLink(null, 'Draft')).toBeUndefined();
    expect(wrapShareLink(undefined, 'Draft')).toBeUndefined();
  });
});

describe('sharePoster', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
  });

  const setShare = (share: ReturnType<typeof vi.fn>) => {
    Object.assign(navigator, { share, canShare: () => true });
  };

  it('passes text and url to the share sheet with the image', async () => {
    const share = vi.fn(async (_data: ShareData) => undefined);
    setShare(share);
    const link = { text: 'EDC on Festie', url: 'https://festie.us/f/edc?ref=share-wrap' };
    await sharePoster(document.createElement('div'), 'wrap.png', 'My Wrap', vi.fn(), link);
    const arg = share.mock.calls[0]![0];
    expect(arg.title).toBe('My Wrap');
    expect(arg.text).toBe(link.text);
    expect(arg.url).toBe(link.url);
    expect(arg.files).toHaveLength(1);
  });

  it('shares the image alone when no link is given', async () => {
    const share = vi.fn(async (_data: ShareData) => undefined);
    setShare(share);
    await sharePoster(document.createElement('div'), 'wrap.png', 'My Wrap', vi.fn());
    const arg = share.mock.calls[0]![0];
    expect(arg.url).toBeUndefined();
    expect(arg.text).toBeUndefined();
  });
});
