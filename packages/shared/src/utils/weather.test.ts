import { describe, it, expect } from 'vitest';
import { weatherCodeLabel, formatTemp, selectWeatherNow, type WeatherForecast } from './weather';

describe('weatherCodeLabel', () => {
  it.each([
    [0, 'Clear'], [1, 'Partly cloudy'], [2, 'Partly cloudy'], [3, 'Cloudy'], [45, 'Fog'], [48, 'Fog'],
    [51, 'Drizzle'], [57, 'Drizzle'], [61, 'Rain'], [67, 'Rain'], [71, 'Snow'], [77, 'Snow'],
    [80, 'Showers'], [82, 'Showers'], [85, 'Snow showers'], [86, 'Snow showers'],
    [95, 'Thunderstorms'], [99, 'Thunderstorms'], [4, ''], [58, ''], [100, ''],
  ])('%i -> %s', (code, label) => expect(weatherCodeLabel(code)).toBe(label));
});

describe('formatTemp', () => {
  it('uses Fahrenheit for US and Celsius otherwise', () => {
    expect(formatTemp(24, 'en-US')).toBe('75°F');
    expect(formatTemp(24, 'en-GB')).toBe('24°C');
  });
});

function forecast(precip: number[], startHour = 12): WeatherForecast {
  const times = precip.map((_, i) => {
    const h = startHour + i;
    const day = h >= 24 ? '2026-11-02' : '2026-11-01';
    return `${day}T${String(h % 24).padStart(2, '0')}:00`;
  });
  return {
    available: true, latitude: 1, longitude: 2, timezone: 'America/New_York',
    daily: { dates: ['2026-11-01'], maxTemp: [20], minTemp: [10], precipChance: [0], weatherCode: [0] },
    hourly: { times, temp: precip.map(() => 24), precipChance: precip, weatherCode: precip.map(() => 2) },
  };
}

describe('selectWeatherNow', () => {
  // DST ended 2026-11-01, so New York is UTC-5: 18:30Z is 13:30 local.
  const now = Date.parse('2026-11-01T18:30:00Z');
  it('picks the current hour in the festival time zone', () => {
    const w = selectWeatherNow(forecast(Array(10).fill(0), 12), now, 'en-GB')!;
    expect(w.temp).toBe('24°C');
    expect(w.condition).toBe('Partly cloudy');
    expect(w.hours).toHaveLength(6);
    expect(w.hours[0].label).toBe('2 PM');
    expect(w.hours[0].a11y).toBe('2 PM, 24°C, 0% chance of rain');
    expect(w.todayHigh).toBe('20°C');
    expect(w.todayLow).toBe('10°C');
  });
  it('crosses a UTC date boundary and labels midnight 12 AM', () => {
    // 03:30Z on the 2nd is 22:30 local on the 1st.
    const w = selectWeatherNow(forecast(Array(5).fill(0), 20), Date.parse('2026-11-02T03:30:00Z'), 'en-GB')!;
    expect(w.hours.map((h) => h.label)).toEqual(['11 PM', '12 AM']);
  });
  it('returns null when unavailable or not covered', () => {
    expect(selectWeatherNow({ available: false, reason: 'x' }, now)).toBeNull();
    expect(selectWeatherNow(null, now)).toBeNull();
    expect(selectWeatherNow(forecast([0, 0], 3), now)).toBeNull();
  });
  it('rainLikely is true at 51 and false at 50', () => {
    expect(selectWeatherNow(forecast([0, 51], 13), now, 'en-GB')!.rainLikely).toBe(true);
    expect(selectWeatherNow(forecast([0, 50], 13), now, 'en-GB')!.rainLikely).toBe(false);
  });
});
