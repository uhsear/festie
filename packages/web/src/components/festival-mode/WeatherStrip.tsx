import { useFestivalWeather } from '@festie/shared/hooks';
import { timeAgo } from '@festie/shared/utils';

interface Props {
  festivalId: string;
  nowMs: number;
}

/** Temperature now, the next 6 hours and a rain warning, from the downloaded forecast. */
export default function WeatherStrip({ festivalId, nowMs }: Props) {
  const { weather, fetchedAt, stale } = useFestivalWeather(festivalId, nowMs);
  if (!weather) return null;

  const hasRange = weather.todayHigh != null && weather.todayLow != null;
  const nowLine =
    `Now ${weather.temp}` +
    (weather.condition ? ` · ${weather.condition}` : '') +
    (hasRange ? ` · High ${weather.todayHigh} · Low ${weather.todayLow}` : '');

  return (
    <section aria-label="Weather" data-testid="fm-weather" className="flex flex-col gap-2 min-w-0">
      <div className="rounded-xl border border-border bg-bg-card px-4 py-3 flex flex-col gap-3 min-w-0">
        <p className="type-label font-semibold text-text-primary [overflow-wrap:anywhere]">{nowLine}</p>
        {weather.hours.length > 0 && (
          <ul className="list-none m-0 p-0 flex gap-3 overflow-x-auto">
            {weather.hours.map((hour) => (
              <li
                key={hour.label + hour.temp}
                data-testid="fm-weather-hour"
                aria-label={hour.a11y}
                className="flex flex-col items-center shrink-0 min-w-[56px]"
              >
                <span className="type-caption text-text-secondary">{hour.label}</span>
                <span className="type-label text-text-primary">{hour.temp}</span>
                <span className="type-caption text-accent-aqua tabular-nums">{hour.precipChance}% rain</span>
              </li>
            ))}
          </ul>
        )}
        {weather.rainLikely && (
          <p className="type-caption text-accent-amber">Rain likely in the next 6 hours. Bring a poncho.</p>
        )}
        {stale && fetchedAt != null && (
          <p className="type-caption text-text-muted">Forecast updated {timeAgo(fetchedAt)}</p>
        )}
      </div>
    </section>
  );
}
