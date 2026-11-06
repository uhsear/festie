import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { useGeolocationWatch } from './useGeolocationWatch';

const watchPosition = vi.fn();
const clearWatch = vi.fn();
const getCurrentPosition = vi.fn();

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.clearAllMocks();
  let id = 0;
  watchPosition.mockImplementation(() => ++id);
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition, clearWatch, getCurrentPosition },
  });
  useFestivalModeStore.getState().setLowPowerMode(false);
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useGeolocationWatch', () => {
  it('seeds from a recent low-accuracy fix when the watch never calls back', () => {
    const { result } = renderHook(() => useGeolocationWatch());
    act(() => result.current.enableLocation());
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: false, maximumAge: 300_000 });
    act(() => getCurrentPosition.mock.calls[0][0]({ coords: { latitude: 28.5, longitude: -81.4, accuracy: 900 } }));
    expect(result.current.selfCoord).toEqual({ latitude: 28.5, longitude: -81.4 });
    expect(result.current.geoState).toBe('on');
  });

  it('does not let a late seed overwrite a watch fix', () => {
    const { result } = renderHook(() => useGeolocationWatch());
    act(() => result.current.enableLocation());
    act(() => watchPosition.mock.calls[0][0]({ coords: { latitude: 28.5, longitude: -81.4, accuracy: 5 } }));
    act(() => getCurrentPosition.mock.calls[0][0]({ coords: { latitude: 1, longitude: 2, accuracy: 900 } }));
    expect(result.current.selfCoord).toEqual({ latitude: 28.5, longitude: -81.4 });
    expect(result.current.accuracyM).toBe(5);
  });

  it('gives up on Finding you after 15 s, and a later fix still wins', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGeolocationWatch());
    act(() => result.current.enableLocation());
    act(() => vi.advanceTimersByTime(14_999));
    expect(result.current.geoState).toBe('locating');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.geoState).toBe('unavailable');
    act(() => watchPosition.mock.calls[0][0]({ coords: { latitude: 28.5, longitude: -81.4, accuracy: 5 } }));
    expect(result.current.geoState).toBe('on');
  });

  it('clears the no-fix timer on unmount', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useGeolocationWatch());
    act(() => result.current.enableLocation());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts with high accuracy', () => {
    const { result } = renderHook(() => useGeolocationWatch());
    act(() => result.current.enableLocation());
    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(watchPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true, maximumAge: 5_000 });
  });

  it('restarts with balanced accuracy when low-power mode turns on', () => {
    const { result } = renderHook(() => useGeolocationWatch());
    act(() => result.current.enableLocation());
    act(() => useFestivalModeStore.getState().setLowPowerMode(true));

    expect(clearWatch).toHaveBeenCalledWith(1);
    expect(watchPosition).toHaveBeenCalledTimes(2);
    expect(watchPosition.mock.calls[1][2]).toEqual({ enableHighAccuracy: false, maximumAge: 30_000, timeout: 20_000 });
  });

  it('does not start a watch when low-power flips before the user enabled location', () => {
    renderHook(() => useGeolocationWatch());
    act(() => useFestivalModeStore.getState().setLowPowerMode(true));
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it('stops while the tab is hidden and restarts when visible', () => {
    const { result } = renderHook(() => useGeolocationWatch());
    act(() => result.current.enableLocation());

    act(() => setVisibility('hidden'));
    expect(clearWatch).toHaveBeenCalledWith(1);
    expect(watchPosition).toHaveBeenCalledTimes(1);

    act(() => setVisibility('visible'));
    expect(watchPosition).toHaveBeenCalledTimes(2);
  });

  it('does not restart on visible if the user never enabled location', () => {
    renderHook(() => useGeolocationWatch());
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it('treats a refusal (code 1) as denied and stops the watch', () => {
    const { result } = renderHook(() => useGeolocationWatch());
    act(() => result.current.enableLocation());
    act(() => watchPosition.mock.calls[0][1]({ code: 1 }));
    expect(result.current.geoState).toBe('denied');
    expect(clearWatch).toHaveBeenCalledWith(1);
  });

  it('treats a timeout (code 3) as unavailable and keeps watching, then recovers on a fix', () => {
    const { result } = renderHook(() => useGeolocationWatch());
    act(() => result.current.enableLocation());
    act(() => watchPosition.mock.calls[0][1]({ code: 3 }));
    expect(result.current.geoState).toBe('unavailable');
    expect(clearWatch).not.toHaveBeenCalled();

    act(() => watchPosition.mock.calls[0][0]({ coords: { latitude: 28.5, longitude: -81.4, accuracy: 12.4 } }));
    expect(result.current.geoState).toBe('on');
    expect(result.current.selfCoord).toEqual({ latitude: 28.5, longitude: -81.4 });
    expect(result.current.accuracyM).toBe(12.4);
  });

  it('retryLocation clears the watch, then starts a new one', () => {
    const { result } = renderHook(() => useGeolocationWatch());
    act(() => result.current.enableLocation());
    act(() => result.current.retryLocation());
    expect(clearWatch).toHaveBeenCalledWith(1);
    expect(watchPosition).toHaveBeenCalledTimes(2);
    expect(clearWatch.mock.invocationCallOrder[0]).toBeLessThan(watchPosition.mock.invocationCallOrder[1]);
  });

  it('reports unavailable when the browser has no geolocation API', () => {
    Object.defineProperty(global.navigator, 'geolocation', { configurable: true, value: undefined });
    const { result } = renderHook(() => useGeolocationWatch());
    act(() => result.current.enableLocation());
    expect(result.current.geoState).toBe('unavailable');
  });
});
