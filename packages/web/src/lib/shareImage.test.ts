import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const toBlob = vi.fn();
vi.mock('html-to-image', () => ({ toBlob: (...a: unknown[]) => toBlob(...a) }));

import { captureAndShareImage } from './shareImage';

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
