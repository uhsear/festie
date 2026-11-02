import { useEffect, useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import { useWeatherStore } from '../stores/weatherStore';
import { selectWeatherNow, type WeatherNow } from '../utils/weather';

const REFRESH_MS = 30 * 60 * 1000;
const STALE_MS = 60 * 60 * 1000;

export function useFestivalWeather(
  festivalId: string | null | undefined,
  nowMs: number,
): { weather: WeatherNow | null; fetchedAt: number | null; stale: boolean } {
  const user = useAuthStore((s) => s.user);
  const offlineMode = useUIStore((s) => s.offlineMode);
  const entry = useWeatherStore((s) => (festivalId ? s.byFestival[festivalId] : undefined));
  const loadWeather = useWeatherStore((s) => s.loadWeather);
  const hasUser = !!user;
  const fetchedAt = entry?.fetchedAt ?? null;
  const needsLoad = fetchedAt == null || nowMs - fetchedAt > REFRESH_MS;

  useEffect(() => {
    if (!hasUser || !festivalId || offlineMode || !needsLoad) return;
    // The cached forecast stays on screen and the offline card reports download failures.
    loadWeather(festivalId).catch(() => {});
  }, [hasUser, festivalId, offlineMode, needsLoad, loadWeather]);

  const weather = useMemo(
    () => (hasUser ? selectWeatherNow(entry?.forecast, nowMs) : null),
    [hasUser, entry, nowMs],
  );
  return { weather, fetchedAt, stale: offlineMode || (fetchedAt != null && nowMs - fetchedAt > STALE_MS) };
}
