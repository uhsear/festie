import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFestivalStore, useFestivalDataStore } from '@festie/shared/stores/festivalStore';
import { nowPositionPercent, resolveFestivalTimeZone } from '@festie/shared/utils';
import type { TimeBounds } from './useTimelineFilters';

/**
 * Provides a live "now" position (0-100 %) within the visible time range, a
 * ref to attach to the grid container, and a `scrollToNow` helper that
 * smoothly brings the now-line into view.
 *
 * The internal tick fires every 30 s so the indicator creeps forward without
 * forcing the parent to rerender.
 *
 * Position comes from the shared `nowPositionPercent`: it measures now from
 * the selected day's date at 00:00 in the festival zone, so it only shows on
 * the festival day whose window (minMin..maxMin, past 1440 for after-midnight
 * sets) contains now. A 1 AM now-line lands on the previous night's tab.
 */
export function useNowIndicator(timeBounds: TimeBounds | null, selectedDay: number) {
  // Minute-tick so the now-indicator advances independently.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const days = useFestivalStore((s) => s.days);
  const timeZone = useFestivalDataStore((s) => resolveFestivalTimeZone(s.currentFestival));

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const nowIndicator = useMemo(() => {
    if (!timeBounds) return null;

    return nowPositionPercent(nowTick, days[selectedDay]?.date, timeBounds, timeZone);
  }, [timeBounds, nowTick, days, selectedDay, timeZone]);

  // Auto-scroll-to-now once per day switch.
  const gridRef = useRef<HTMLDivElement | null>(null);

  const scrollToNow = useCallback(() => {
    const el = gridRef.current;
    if (!el || nowIndicator === null) return;
    const target = el.querySelector<HTMLElement>('.timeline-now-label');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [nowIndicator]);

  useEffect(() => {
    if (nowIndicator === null) return;
    const id = window.requestAnimationFrame(() => scrollToNow());
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay]);

  return { nowIndicator, gridRef, scrollToNow };
}
