import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { useGeolocationWatch } from './useGeolocationWatch';

const watchPosition = vi.fn();
const clearWatch = vi.fn();

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
    value: { watchPosition, clearWatch },
  });
  useFestivalModeStore.getState().setLowPowerMode(false);
  setVisibility('visible');
});

describe('useGeolocationWatch', () => {
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
});
