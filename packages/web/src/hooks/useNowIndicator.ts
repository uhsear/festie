import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useReducedMotion } from 'motion/react';
import { useFestivalStore, useFestivalDataStore } from '@festie/shared/stores/festivalStore';
import { nowPositionPercent, resolveFestivalTimeZone } from '@festie/shared/utils';
import type { TimeBounds } from './useTimelineFilters';

/**
 * Provides a live "now" position (0-100 %) within the visible time range, a
 * ref to attach to the grid container, and a `scrollToNow` helper that
 * brings the now-line into view (smoothly, unless the user prefers reduced
 * motion). The automatic day-switch scroll always jumps.
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

  const reducedMotion = useReducedMotion();

  const scrollToNowWith = useCallback(
    (behavior: ScrollBehavior) => {
      const el = gridRef.current;
      if (!el || nowIndicator === null) return;
      const target = el.querySelector<HTMLElement>('.timeline-now-label');
      if (!target) return;
      target.scrollIntoView({ behavior, block: 'center' });
    },
    [nowIndicator],
  );

  const scrollToNow = useCallback(
    () => scrollToNowWith(reducedMotion ? 'auto' : 'smooth'),
    [scrollToNowWith, reducedMotion],
  );

  // Read through a ref so the 30 s tick does not re-scroll; only a day switch does.
  const scrollToNowRef = useRef(scrollToNowWith);
  useEffect(() => {
    scrollToNowRef.current = scrollToNowWith;
  }, [scrollToNowWith]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => scrollToNowRef.current('auto'));
    return () => window.cancelAnimationFrame(id);
  }, [selectedDay]);

  return { nowIndicator, gridRef, scrollToNow };
}
