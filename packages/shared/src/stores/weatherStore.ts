import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '../services/api';
import { getStorage } from '../platform/storage';
import type { WeatherForecast } from '../utils/weather';

// Not cleared on logout (not in resetStores.ts): the forecast keys off the festival's coordinates, not the user.

const MAX_FESTIVALS = 5;

export interface WeatherEntry { forecast: WeatherForecast; fetchedAt: number }
export interface WeatherState {
  byFestival: Record<string, WeatherEntry>;
  /** Throws on failure and keeps the old entry. */
  loadWeather: (festivalId: string) => Promise<void>;
}

export const useWeatherStore = create<WeatherState>()(
  persist(
    (set, get) => ({
      byFestival: {},
      loadWeather: async (festivalId) => {
        const forecast = await api.get<WeatherForecast>(`/weather/${festivalId}`);
        // The route answers 200 { available: false } when Open-Meteo is slow or down;
        // never let that replace a real forecast the strip can still show offline.
        if (!forecast.available && get().byFestival[festivalId]?.forecast.available) {
          throw new Error(forecast.reason || 'Weather service unavailable');
        }
        set((state) => {
          const next = { ...state.byFestival, [festivalId]: { forecast, fetchedAt: Date.now() } };
          const ids = Object.keys(next);
          if (ids.length > MAX_FESTIVALS) {
            const oldest = ids.reduce((a, b) => ((next[a]?.fetchedAt ?? 0) <= (next[b]?.fetchedAt ?? 0) ? a : b));
            delete next[oldest];
          }
          return { byFestival: next };
        });
      },
    }),
    {
      name: 'festie-weather',
      storage: createJSONStorage(() => getStorage()),
      partialize: (state) => ({ byFestival: state.byFestival }),
    },
  ),
);
