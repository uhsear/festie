import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLastKnownFix } from './useLastKnownFix';

const getCurrentPosition = vi.fn();

function stubNav(state: PermissionState | 'none') {
  vi.stubGlobal('navigator', {
    geolocation: { getCurrentPosition },
    ...(state === 'none' ? {} : { permissions: { query: vi.fn().mockResolvedValue({ state }) } }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  getCurrentPosition.mockReset();
});

describe('useLastKnownFix', () => {
  it('never reads a position when permission is prompt', async () => {
    stubNav('prompt');
    renderHook(() => useLastKnownFix());
    await new Promise((r) => setTimeout(r, 10));
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('returns the coord and time when permission is granted', async () => {
    stubNav('granted');
    getCurrentPosition.mockImplementation((ok) => ok({ coords: { latitude: 1, longitude: 2 }, timestamp: 1234 }));
    const { result } = renderHook(() => useLastKnownFix());
    await waitFor(() => expect(result.current.at).toBe(1234));
    expect(result.current.coord).toEqual({ latitude: 1, longitude: 2 });
  });

  it('re-checks permission each tick and stops reading once it is no longer granted', async () => {
    vi.useFakeTimers();
    try {
      const query = vi.fn().mockResolvedValueOnce({ state: 'granted' }).mockResolvedValue({ state: 'prompt' });
      vi.stubGlobal('navigator', { geolocation: { getCurrentPosition }, permissions: { query } });
      renderHook(() => useLastKnownFix());
      await vi.advanceTimersByTimeAsync(0);
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(query).toHaveBeenCalledTimes(2);
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('picks up a grant given later in the session', async () => {
    vi.useFakeTimers();
    try {
      const query = vi.fn().mockResolvedValueOnce({ state: 'prompt' }).mockResolvedValue({ state: 'granted' });
      vi.stubGlobal('navigator', { geolocation: { getCurrentPosition }, permissions: { query } });
      renderHook(() => useLastKnownFix());
      await vi.advanceTimersByTimeAsync(0);
      expect(getCurrentPosition).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing without the Permissions API', async () => {
    stubNav('none');
    const { result } = renderHook(() => useLastKnownFix());
    await new Promise((r) => setTimeout(r, 10));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(result.current).toEqual({ coord: null, at: null });
  });
});
