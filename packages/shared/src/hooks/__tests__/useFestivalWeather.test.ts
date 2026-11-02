import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFestivalWeather } from '../useFestivalWeather';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { useWeatherStore } from '../../stores/weatherStore';

const NOW = Date.parse('2026-11-01T18:30:00Z');
const loadWeather = vi.fn().mockResolvedValue(undefined);

function setup(over: { user?: boolean; offline?: boolean; fetchedAt?: number }) {
  useAuthStore.setState({ user: over.user === false ? null : ({ id: 'u1' } as never) });
  useUIStore.setState({ offlineMode: !!over.offline });
  useWeatherStore.setState({
    loadWeather,
    byFestival:
      over.fetchedAt == null
        ? {}
        : { f1: { forecast: { available: false, reason: 'x' }, fetchedAt: over.fetchedAt } },
  });
}

describe('useFestivalWeather', () => {
  beforeEach(() => loadWeather.mockClear());

  it('does not fetch when offline', () => {
    setup({ offline: true });
    const { result } = renderHook(() => useFestivalWeather('f1', NOW));
    expect(loadWeather).not.toHaveBeenCalled();
    expect(result.current.stale).toBe(true);
  });

  it('does not fetch without a user and returns no weather', () => {
    setup({ user: false });
    const { result } = renderHook(() => useFestivalWeather('f1', NOW));
    expect(loadWeather).not.toHaveBeenCalled();
    expect(result.current.weather).toBeNull();
  });

  it('fetches when the entry is older than 30 minutes', () => {
    setup({ fetchedAt: NOW - 31 * 60 * 1000 });
    const { result } = renderHook(() => useFestivalWeather('f1', NOW));
    expect(loadWeather).toHaveBeenCalledWith('f1');
    expect(result.current.stale).toBe(false);
  });

  it('does not fetch for a fresh entry', () => {
    setup({ fetchedAt: NOW - 5 * 60 * 1000 });
    renderHook(() => useFestivalWeather('f1', NOW));
    expect(loadWeather).not.toHaveBeenCalled();
  });
});
