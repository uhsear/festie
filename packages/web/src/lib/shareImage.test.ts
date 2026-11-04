import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const toBlob = vi.fn();
const getFontEmbedCSS = vi.fn();
vi.mock('html-to-image', () => ({
  toBlob: (...a: unknown[]) => toBlob(...a),
  getFontEmbedCSS: (...a: unknown[]) => getFontEmbedCSS(...a),
}));

import { captureAndShareImage, captureAndShareImages } from './shareImage';

const OPTS = { width: 10, height: 20, filename: 'x.png', title: 'X' };

describe('captureAndShareImage', () => {
  beforeEach(() => {
    toBlob.mockReset();
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => cb());
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });

  it('throws Capture failed on a null blob', async () => {
    toBlob.mockResolvedValue(null);
    await expect(captureAndShareImage(document.createElement('div'), OPTS)).rejects.toThrow('Capture failed');
  });

  it('downloads when files cannot be shared', async () => {
    toBlob.mockResolvedValue(new Blob(['a']));
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(captureAndShareImage(document.createElement('div'), OPTS)).resolves.toBe('downloaded');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('returns cancelled on AbortError from share', async () => {
    toBlob.mockResolvedValue(new Blob(['a']));
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: () => Promise.reject(new DOMException('x', 'AbortError')),
      configurable: true,
    });
    await expect(captureAndShareImage(document.createElement('div'), OPTS)).resolves.toBe('cancelled');
  });
});

describe('captureAndShareImages', () => {
  const nodes = () => [document.createElement('div'), document.createElement('div'), document.createElement('div')];
  const opts = { width: 10, height: 20, filenames: ['a.png', 'b.png', 'c.png'], title: 'X' };
  beforeEach(() => {
    toBlob.mockReset().mockResolvedValue(new Blob(['a']));
    getFontEmbedCSS.mockReset().mockResolvedValue('@font-face{}');
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => cb());
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });

  it('embeds fonts once and shares all files in one call', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    await expect(captureAndShareImages(nodes(), opts)).resolves.toBe('shared');
    expect(getFontEmbedCSS).toHaveBeenCalledTimes(1);
    expect(toBlob).toHaveBeenCalledTimes(3);
    expect(toBlob.mock.calls.every((c) => (c[1] as { fontEmbedCSS: string }).fontEmbedCSS === '@font-face{}')).toBe(true);
    expect(share).toHaveBeenCalledTimes(1);
    expect((share.mock.calls[0]![0] as { files: File[] }).files.map((f) => f.name)).toEqual(['a.png', 'b.png', 'c.png']);
  });

  it('downloads each file when files cannot be shared', async () => {
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(captureAndShareImages(nodes(), opts)).resolves.toBe('downloaded');
    expect(click).toHaveBeenCalledTimes(3);
  });
});
