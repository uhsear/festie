import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import {
  selectNowNext,
  resolveFestivalTimeZone,
  artistDisplayName,
  fmtStartsIn,
  fmtTimeLeft,
} from '@festie/shared/utils';
import { useNow } from '../../hooks/useSetStatus';

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
  const stages = useFestivalStore((s) => s.stages);
  const picks = useFestivalStore((s) => s.currentProfile?.picks);
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
  const name = artistDisplayName(focus.set, currentFestival?.b2bSeparator);
  const stage = stages.find((s) => s.id === focus.set.stageId)?.name ?? focus.set.stageName ?? '';
  const timing = isNow ? fmtTimeLeft(focus.end, nowMs) : fmtStartsIn(focus.start, nowMs, timeZone);
  const progress = isNow
    ? Math.min(100, Math.max(0, ((nowMs - focus.start) / Math.max(1, focus.end - focus.start)) * 100))
    : 0;

  return (
    <div className="px-6 pt-3">
      <button
        type="button"
        onClick={() => navigate({ to: '/festival-mode' })}
        data-testid="now-next-strip"
        aria-label={`${isNow ? 'Now playing' : 'Up next'}: ${name}${stage ? ` at ${stage}` : ''}, ${timing}. Open Now and Next.`}
        className="relative flex w-full max-w-[1440px] mx-auto min-h-14 items-center gap-3 overflow-hidden rounded-lg border border-border-default bg-bg-secondary px-4 text-left"
      >
        <span
          className={
            isNow
              ? 'inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-accent-coral'
              : 'text-xs font-semibold uppercase tracking-[0.04em] text-text-secondary'
          }
        >
          {isNow && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-accent-coral" />}
          {isNow ? 'NOW' : 'UP NEXT'}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-text-primary">{name}</span>
          {stage && <span className="text-text-secondary">{` · ${stage}`}</span>}
        </span>
        <span className="shrink-0 text-sm text-text-secondary tabular-nums">{timing}</span>
        {isNow && (
          <span
            aria-hidden="true"
            data-testid="now-next-progress"
            className="absolute bottom-0 left-0 h-0.5 bg-accent-coral"
            style={{ width: `${progress}%` }}
          />
        )}
      </button>
    </div>
  );
}
