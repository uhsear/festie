export type WeatherForecast =
  | { available: false; reason: string }
  | {
      available: true; latitude: number; longitude: number; timezone: string;
      daily: { dates: string[]; maxTemp: number[]; minTemp: number[]; precipChance: number[]; weatherCode: number[] };
      hourly: { times: string[]; temp: number[]; precipChance: number[]; weatherCode: number[] };
    };

export interface WeatherHour { label: string; temp: string; precipChance: number; a11y: string }
export interface WeatherNow {
  temp: string;
  condition: string;
  precipChance: number;
  hours: WeatherHour[];
  rainLikely: boolean;
  todayHigh: string | null;
  todayLow: string | null;
}

export function weatherCodeLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code === 1 || code === 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95 && code <= 99) return 'Thunderstorms';
  return '';
}

// Regex, not Intl.Locale: Hermes support is not certain.
const FAHRENHEIT_RE = /-(US|PR|GU|VI|AS|MP|LR|MM|BS|BZ|KY|PW)\b/i;

export function formatTemp(celsius: number, locale?: string): string {
  const loc = locale ?? Intl.DateTimeFormat().resolvedOptions().locale;
  return FAHRENHEIT_RE.test(loc)
    ? `${Math.round((celsius * 9) / 5 + 32)}°F`
    : `${Math.round(celsius)}°C`;
}

function hourKey(nowMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}`;
}

function hourLabel(time: string): string {
  const h = parseInt(time.slice(11, 13), 10);
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

export function selectWeatherNow(
  forecast: WeatherForecast | null | undefined,
  nowMs: number,
  locale?: string,
): WeatherNow | null {
  if (!forecast || !forecast.available) return null;
  const { hourly, daily } = forecast;
  const key = hourKey(nowMs, forecast.timezone);
  const i = hourly.times.findIndex((t) => t.startsWith(key));
  if (i < 0) return null;
  const hours: WeatherHour[] = [];
  for (let j = i + 1; j < hourly.times.length && hours.length < 6; j++) {
    const label = hourLabel(hourly.times[j] ?? '');
    const temp = formatTemp(hourly.temp[j] ?? 0, locale);
    const precipChance = hourly.precipChance[j] ?? 0;
    hours.push({ label, temp, precipChance, a11y: `${label}, ${temp}, ${precipChance}% chance of rain` });
  }
  const d = daily.dates.indexOf(key.slice(0, 10));
  const nowPrecip = hourly.precipChance[i] ?? 0;
  const maxTemp = daily.maxTemp[d];
  const minTemp = daily.minTemp[d];
  return {
    temp: formatTemp(hourly.temp[i] ?? 0, locale),
    condition: weatherCodeLabel(hourly.weatherCode[i] ?? -1),
    precipChance: nowPrecip,
    hours,
    rainLikely: nowPrecip > 50 || hours.some((h) => h.precipChance > 50),
    todayHigh: maxTemp != null ? formatTemp(maxTemp, locale) : null,
    todayLow: minTemp != null ? formatTemp(minTemp, locale) : null,
  };
}
