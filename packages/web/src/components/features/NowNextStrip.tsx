import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import {
  selectNowNext,
  resolveFestivalTimeZone,
  artistDisplayName,
  fmtStartsIn,
  fmtTimeLeft,
} from '@festie/shared/utils';
import { useNow } from '../../hooks/useSetStatus';
import { cn } from '../../lib/utils';
import ArtistName, { RowOpenButton } from './ArtistName';

/**
 * Compact "Now / Up next" strip for the schedule views (Cards, Timeline, Grid).
 * Reads the picked set playing now, else the soonest upcoming pick, and opens
 * Now & Next. Renders nothing for guests, users without picks, or when nothing
 * is playing or upcoming. Uses the same selector as festival-mode.
 */
export default function NowNextStrip() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const { getStageName } = useFestival();
  const picks = useFestivalStore((s) => s.currentProfile?.picks);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const nowMs = useNow();
  const timeZone = resolveFestivalTimeZone(currentFestival);

  const selection = useMemo(() => {
    if (!user || !picks || Object.keys(picks).length === 0) return null;
    return selectNowNext({ sets, days, picks, nowMs, timeZone, upcomingLimit: 1 });
  }, [user, picks, sets, days, nowMs, timeZone]);

  const current = selection?.current[0];
  const focus = current ?? selection?.upcoming[0];
  if (!focus) return null;

  const isNow = !!current;
  // The strip is about the clock, not the list: on another day's tab it says so rather than seem to describe that list.
  const nowOnAnotherDay = isNow && typeof selectedDay === 'number' && selectedDay !== focus.set.dayIndex;
  const name = artistDisplayName(focus.set, currentFestival?.b2bSeparator);
  const stage = getStageName(focus.set.stageId) ?? focus.set.stageName ?? '';
  const timing = isNow ? fmtTimeLeft(focus.end, nowMs) : fmtStartsIn(focus.start, nowMs, timeZone);
  const progress = isNow
    ? Math.min(100, Math.max(0, ((nowMs - focus.start) / Math.max(1, focus.end - focus.start)) * 100))
    : 0;

  return (
    <section aria-label="Now and next" className="px-6 pt-3">
      <div
        key={focus.set.id}
        data-testid="now-next-strip"
        className={cn(
          'fm-card-enter motion-reduce:animate-none relative flex w-full max-w-[1440px] mx-auto min-h-14 items-center gap-3 overflow-hidden rounded-xl border border-border-default bg-bg-secondary px-4 text-left',
          isNow && 'pb-4',
        )}
      >
        <RowOpenButton
          label={`${isNow ? 'Now playing' : 'Up next'}: ${name}${stage ? ` at ${stage}` : ''}, ${timing}. Open Now and Next.`}
          onClick={() => navigate({ to: '/festival-mode' })}
        />
        <span
          className={
            isNow
              ? 'inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-live-text'
              : 'text-xs font-semibold uppercase tracking-[0.04em] text-text-secondary'
          }
        >
          {isNow && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-live-fill" />}
          {isNow ? (nowOnAnotherDay ? 'NOW · TODAY' : 'NOW') : 'UP NEXT'}
        </span>
        <span className="min-w-0 max-w-[720px]">
          <span className="block text-lg font-bold text-text-primary line-clamp-2 break-words">
            <ArtistName set={focus.set} separator={currentFestival?.b2bSeparator} />
          </span>
          {stage && <span className="block truncate text-text-secondary">{stage}</span>}
        </span>
        <span className="shrink-0 text-sm font-semibold text-text-secondary tabular-nums">{timing}</span>
        <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
        {isNow && (
          // Inset by the card radius so the bar follows the rounded corners instead of being clipped to a hairline.
          <span aria-hidden="true" className="absolute inset-x-3 bottom-1.5 h-1 rounded-full bg-live-ring">
            <span
              data-testid="now-next-progress"
              className="block h-full rounded-full bg-live-fill"
              style={{ width: `${progress}%` }}
            />
          </span>
        )}
      </div>
    </section>
  );
}
