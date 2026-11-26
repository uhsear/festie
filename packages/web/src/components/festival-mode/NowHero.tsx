import type { ReactNode } from 'react';
import { CalendarClock, Footprints, Music, PartyPopper } from 'lucide-react';
import type { FestivalSet } from '@festie/shared/types';
import {
  artistDisplayName,
  fmtStartsIn,
  fmtTimeLeft,
  fmtZonedClock,
  fmtZonedDayClock,
  fmtZonedWeekday,
  startsInIsRelative,
  type DayOfSet,
  type NowNextSelection,
  type StageWalk,
} from '@festie/shared/utils';
import { COPY } from '@festie/shared/constants';
import { CONCEPT_ICON } from '../../lib/conceptIcons';
import Button from '../ui/Button';
import { cn } from '@/lib/utils';
import ArtistName, { RowOpenButton } from '../features/ArtistName';

// Countdown turns amber and bold when a set is this close, so "go now" reads
// at a glance in a crowd.
const IMMINENT_MIN = 5;

interface Props {
  selection: NowNextSelection;
  nowMs: number;
  timeZone?: string;
  b2bSeparator?: string;
  /** True when NOW/NEXT come from the whole lineup (guest). */
  lineupMode: boolean;
  getStageName: (stageId: string) => string | undefined;
  onOpenSet: (set: FestivalSet) => void;
  onBrowse: () => void;
  onWrap?: () => void;
  /** Walk to the next set's stage, when a recent fix exists. */
  walk?: StageWalk | null;
}

const DAY_MS = 86_400_000;

function startsInWords(startsAt: number, nowMs: number, timeZone: string | undefined, timed: boolean): string | undefined {
  if (startsAt - nowMs < DAY_MS / 2) return timed ? `First set ${fmtStartsIn(startsAt, nowMs, timeZone)}.` : undefined;
  const days = Math.ceil((startsAt - nowMs) / DAY_MS);
  return `In ${days} day${days === 1 ? '' : 's'}.`;
}

const card =
  'relative block w-full text-left rounded-lg border bg-bg-card p-4 transition-[background-color,transform] duration-[var(--duration-med)] ease-[var(--ease-out)] hover:bg-bg-card-hover active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100';

function Quiet({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-4 flex flex-col gap-3" data-testid="fm-now-empty">
      <div className="flex items-start gap-3">
        <span className="text-text-muted shrink-0 mt-0.5 [&_svg]:w-6 [&_svg]:h-6">{icon}</span>
        <div className="min-w-0">
          <p className="type-title text-text-primary">{title}</p>
          {body && <p className="type-label text-text-secondary mt-1">{body}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/**
 * The top of the Now surface: what is playing now, or the next set with a
 * countdown and where to walk. Falls back to an honest empty state for every
 * phase of the festival.
 */
export default function NowHero({
  selection,
  nowMs,
  timeZone,
  b2bSeparator,
  lineupMode,
  getStageName,
  onOpenSet,
  onBrowse,
  onWrap,
  walk,
}: Props) {
  const { phase, current, upcoming, todayCount, startsAt, startsAtTimed } = selection;
  const live = current.length > 0;
  const next = upcoming[0];
  const name = (s: FestivalSet) => artistDisplayName(s, b2bSeparator);

  let body: ReactNode;
  if (live) {
    body = (
      <div className="flex flex-col gap-2">
        {current.map(({ set, end }: DayOfSet) => {
          const stage = getStageName(set.stageId) || '';
          return (
            <div
              key={set.id}
              data-testid="fm-now-card"
              className={cn(card, 'border-live-fill/60 bg-[var(--color-live-ring)] shadow-[0_6px_24px_-8px_var(--color-live-ring)]')}
            >
              <RowOpenButton
                onClick={() => onOpenSet(set)}
                label={`${name(set)} playing now${stage ? ` at ${stage}` : ''}, ${fmtTimeLeft(end, nowMs)}. Open details`}
              />
              <span className="block font-display font-bold text-2xl leading-tight text-text-primary break-words">
                <ArtistName set={set} separator={b2bSeparator} />
              </span>
              {stage && <span className="block type-label text-text-secondary mt-1">{stage}</span>}
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-2">
                <span className="type-numeral font-semibold text-text-primary">
                  until {fmtZonedClock(end, timeZone)}
                </span>
                <span className="type-numeral text-text-secondary">{fmtTimeLeft(end, nowMs)}</span>
              </span>
            </div>
          );
        })}
      </div>
    );
  } else if (phase === 'none') {
    body = <Quiet icon={<CalendarClock />} title="Set times aren't out yet" body="Now and next appear once the schedule is published." />;
  } else if (phase === 'before') {
    body = (
      <Quiet
        icon={<CalendarClock />}
        title={
          startsAt
            ? `Starts ${startsAtTimed ? fmtZonedDayClock(startsAt, timeZone) : fmtZonedWeekday(startsAt, timeZone)}`
            : 'Not started yet'
        }
        body={startsAt ? startsInWords(startsAt, nowMs, timeZone, startsAtTimed) : undefined}
      />
    );
  } else if (phase === 'after') {
    body = (
      <Quiet
        icon={<PartyPopper />}
        title="That's a wrap"
        body="The festival is over."
        action={
          onWrap && (
            <Button variant="secondary" onClick={onWrap} className="self-start">
              {COPY.wrap.open}
            </Button>
          )
        }
      />
    );
  } else if (!lineupMode && todayCount === 0) {
    body = (
      <Quiet
        icon={<CONCEPT_ICON.picks />}
        title="No picks today"
        body={next ? `Your next pick is ${name(next.set)}, ${fmtStartsIn(next.start, nowMs, timeZone)}.` : 'Pick the sets you want to see today.'}
        action={
          <Button variant="secondary" onClick={onBrowse} className="self-start" data-testid="fm-browse">
            Browse the lineup
          </Button>
        }
      />
    );
  } else if (next) {
    const stage = getStageName(next.set.stageId) || '';
    const mins = Math.floor((next.start - nowMs) / 60_000);
    const imminent = mins <= IMMINENT_MIN;
    const startsIn = fmtStartsIn(next.start, nowMs, timeZone);
    // Past 12 hours the countdown is already a weekday and clock, so a second clock would repeat it.
    const relative = startsInIsRelative(next.start, nowMs);
    body = (
      <div data-testid="fm-next-hero" className={cn(card, 'border-border')}>
        <RowOpenButton
          onClick={() => onOpenSet(next.set)}
          label={`Next: ${name(next.set)}${stage ? ` at ${stage}` : ''}, ${startsIn}${walk ? `, ${walk.minutes} minute walk${walk.late ? ', leave now' : ''}` : ''}. Open details`}
        />
        <span className="block type-micro text-text-secondary">Next</span>
        <span className="block font-display font-bold text-2xl leading-tight text-text-primary break-words mt-1">
          <ArtistName set={next.set} separator={b2bSeparator} />
        </span>
        <span className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 mt-3">
          {stage && (
            <span className="flex items-center gap-1.5 type-label text-text-primary min-w-0">
              <Footprints className="w-4 h-4 shrink-0 text-accent-aqua" aria-hidden="true" />
              <span className="break-words">Head to {stage}{walk ? ` · ${walk.label}` : ''}</span>
            </span>
          )}
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-2xl font-semibold tabular-nums leading-none',
                imminent || walk?.late ? 'text-accent-amber font-bold' : 'text-accent-aqua',
              )}
            >
              {startsIn}
            </span>
            {relative && <span className="type-numeral text-text-secondary">{fmtZonedClock(next.start, timeZone)}</span>}
          </span>
        </span>
      </div>
    );
  } else {
    body = (
      <Quiet
        icon={<Music />}
        title={lineupMode ? 'Nothing else on today' : 'No more picks today'}
        body={lineupMode ? undefined : "You've seen everything on your list."}
      />
    );
  }

  return (
    <section aria-labelledby="fm-now-title" className="flex flex-col gap-2">
      <h2 id="fm-now-title" className="type-label font-semibold text-text-primary flex items-center gap-1">
        {live ? (
          <span className="fm-live-dot motion-reduce:after:animate-none" aria-hidden="true" />
        ) : (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-muted mr-1" aria-hidden="true" />
        )}
        {lineupMode ? 'Now on the lineup' : 'Now'}
      </h2>
      {body}
    </section>
  );
}
