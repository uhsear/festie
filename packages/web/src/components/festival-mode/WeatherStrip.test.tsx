import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let hook: { weather: unknown; fetchedAt: number | null; stale: boolean };
vi.mock('@festie/shared/hooks', () => ({
  useFestivalWeather: () => hook,
}));

import WeatherStrip from './WeatherStrip';

const NOW = Date.UTC(2026, 10, 1, 14, 0);
const hours = Array.from({ length: 6 }, (_, i) => ({
  label: `${i + 3} PM`,
  temp: `${70 + i}°F`,
  precipChance: i * 5,
  a11y: `${i + 3} PM, ${70 + i}°F, ${i * 5}% chance of rain`,
}));
const weather = (over: Record<string, unknown> = {}) => ({
  temp: '68°F',
  condition: 'Partly cloudy',
  precipChance: 10,
  hours,
  rainLikely: false,
  todayHigh: '75°F',
  todayLow: '60°F',
  ...over,
});

describe('WeatherStrip', () => {
  beforeEach(() => {
    hook = { weather: weather(), fetchedAt: NOW, stale: false };
  });

  it('renders the now line and 6 hour cells', () => {
    render(<WeatherStrip festivalId="f1" nowMs={NOW} />);
    expect(screen.getByRole('region', { name: 'Weather' })).toHaveTextContent(
      'Now 68°F · Partly cloudy · High 75°F · Low 60°F',
    );
    expect(screen.getAllByTestId('fm-weather-hour')).toHaveLength(6);
    expect(screen.getByLabelText('3 PM, 70°F, 0% chance of rain')).toHaveTextContent('0% rain');
  });

  it('drops the condition and range when unknown', () => {
    hook = { weather: weather({ condition: '', todayHigh: null, todayLow: null }), fetchedAt: NOW, stale: false };
    render(<WeatherStrip festivalId="f1" nowMs={NOW} />);
    expect(screen.getByText('Now 68°F')).toBeInTheDocument();
  });

  it('shows the poncho line only when rain is likely', () => {
    const { unmount } = render(<WeatherStrip festivalId="f1" nowMs={NOW} />);
    expect(screen.queryByText(/Bring a poncho/)).not.toBeInTheDocument();
    unmount();
    hook = { weather: weather({ rainLikely: true }), fetchedAt: NOW, stale: false };
    render(<WeatherStrip festivalId="f1" nowMs={NOW} />);
    expect(screen.getByText('Rain likely in the next 6 hours. Bring a poncho.')).toBeInTheDocument();
  });

  it('renders nothing without weather', () => {
    hook = { weather: null, fetchedAt: null, stale: false };
    const { container } = render(<WeatherStrip festivalId="f1" nowMs={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows when the forecast was updated while stale', () => {
    hook = { weather: weather(), fetchedAt: NOW - 5 * 60_000, stale: true };
    render(<WeatherStrip festivalId="f1" nowMs={NOW} />);
    expect(screen.getByText(/Forecast updated/)).toBeInTheDocument();
  });
});
