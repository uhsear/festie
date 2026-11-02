import { useMemo } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { isTodayFestivalDay } from '@festie/shared/stores/festivalModeStore';

/**
 * Returns `showDayBanner` for the shell to render the festival-day nudge on
 * festival days, everywhere except the Now & Next page itself. It never
 * navigates: the banner offers the page and the user decides.
 */
export function useFestivalMode(pathname: string) {
  const days = useFestivalStore((s) => s.days);

  const isFestivalDayToday = useMemo(() => {
    const dayDates = days.map((d) => d.date).filter(Boolean) as string[];
    return isTodayFestivalDay(dayDates);
  }, [days]);

  const showDayBanner = isFestivalDayToday && pathname !== '/festival-mode';

  return { showDayBanner };
}
