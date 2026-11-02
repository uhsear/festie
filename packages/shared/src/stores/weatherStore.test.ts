import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWeatherStore } from './weatherStore';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const body = { available: false, reason: 'no coords' };

describe('weatherStore', () => {
  beforeEach(() => {
    useWeatherStore.setState({ byFestival: {} });
    vi.mocked(api.get).mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });
  afterEach(() => vi.useRealTimers());

  it('stores the body and fetchedAt', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(body);
    await useWeatherStore.getState().loadWeather('f1');
    expect(api.get).toHaveBeenCalledWith('/weather/f1');
    expect(useWeatherStore.getState().byFestival.f1).toEqual({ forecast: body, fetchedAt: 1000 });
  });

  it('rejects and keeps the old entry on failure', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(body);
    await useWeatherStore.getState().loadWeather('f1');
    vi.mocked(api.get).mockRejectedValueOnce(new Error('down'));
    await expect(useWeatherStore.getState().loadWeather('f1')).rejects.toThrow('down');
    expect(useWeatherStore.getState().byFestival.f1.fetchedAt).toBe(1000);
  });

  it('keeps a real forecast when the route answers available: false', async () => {
    const real = {
      available: true,
      latitude: 1,
      longitude: 2,
      timezone: 'UTC',
      daily: { dates: [], maxTemp: [], minTemp: [], precipChance: [], weatherCode: [] },
      hourly: { times: [], temp: [], precipChance: [], weatherCode: [] },
    };
    vi.mocked(api.get).mockResolvedValueOnce(real);
    await useWeatherStore.getState().loadWeather('f1');
    vi.setSystemTime(5000);
    vi.mocked(api.get).mockResolvedValueOnce({ available: false, reason: 'Weather request timed out' });
    await expect(useWeatherStore.getState().loadWeather('f1')).rejects.toThrow('Weather request timed out');
    expect(useWeatherStore.getState().byFestival.f1).toEqual({ forecast: real, fetchedAt: 1000 });
  });

  it('drops the oldest when a sixth festival loads', async () => {
    vi.mocked(api.get).mockResolvedValue(body);
    for (let i = 1; i <= 6; i++) {
      vi.setSystemTime(i * 1000);
      await useWeatherStore.getState().loadWeather(`f${i}`);
    }
    const ids = Object.keys(useWeatherStore.getState().byFestival);
    expect(ids).toHaveLength(5);
    expect(ids).not.toContain('f1');
  });
});
