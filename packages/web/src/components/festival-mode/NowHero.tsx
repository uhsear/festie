import type { ReactNode } from 'react';
import { CalendarClock, Footprints, Music, PartyPopper } from 'lucide-react';
import type { FestivalSet } from '@festie/shared/types';
import {
  artistDisplayName,
  fmtStartsIn,
  fmtTimeLeft,
  fmtZonedClock,
  fmtZonedDayClock,
  type DayOfSet,
  type NowNextSelection,
} from '@festie/shared/utils';
import { COPY } from '@festie/shared/constants';
import { CONCEPT_ICON } from '../../lib/conceptIcons';
import Button from '../ui/Button';
import { cn } from '@/lib/utils';

// Countdown turns coral and bold when a set is this close, so "go now" reads
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
}

const DAY_MS = 86_400_000;

function startsInWords(startsAt: number, nowMs: number, timeZone?: string): string {
  if (startsAt - nowMs < DAY_MS / 2) return `First set ${fmtStartsIn(startsAt, nowMs, timeZone)}.`;
  const days = Math.ceil((startsAt - nowMs) / DAY_MS);
  return `In ${days} day${days === 1 ? '' : 's'}.`;
}

const card =
  'block w-full text-left rounded-xl border bg-bg-card p-4 cursor-pointer transition-[background-color,transform] duration-[var(--duration-med)] ease-[var(--ease-out)] hover:bg-bg-card-hover active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

function Quiet({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-3" data-testid="fm-now-empty">
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
}: Props) {
  const { phase, current, upcoming, todayCount, startsAt } = selection;
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
            <button
              key={set.id}
              type="button"
              data-testid="fm-now-card"
              onClick={() => onOpenSet(set)}
              aria-label={`${name(set)} playing now${stage ? ` at ${stage}` : ''}, ${fmtTimeLeft(end, nowMs)}. Open details`}
              className={cn(card, 'border-accent-coral/60 bg-coral-ring shadow-[0_6px_24px_-8px_rgba(var(--accent-coral-rgb),0.45)]')}
            >
              <span className="block font-display font-bold text-2xl leading-tight text-text-primary break-words">
                {name(set)}
              </span>
              {stage && <span className="block type-label text-text-secondary mt-1">{stage}</span>}
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-2">
                <span className="type-numeral font-semibold text-text-primary">
                  until {fmtZonedClock(end, timeZone)}
                </span>
                <span className="type-numeral text-text-secondary">{fmtTimeLeft(end, nowMs)}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  } else if (phase === 'none') {
    body = <Quiet icon={<CalendarClock />} title="Set times aren't out yet" body="Now and next appear once the festival publishes its schedule." />;
  } else if (phase === 'before') {
    body = (
      <Quiet
        icon={<CalendarClock />}
        title={startsAt ? `Starts ${fmtZonedDayClock(startsAt, timeZone)}` : 'Not started yet'}
        body={startsAt ? startsInWords(startsAt, nowMs, timeZone) : undefined}
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
            <Button variant="outline" onClick={onWrap} className="self-start">
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
          <Button variant="outline" onClick={onBrowse} className="self-start" data-testid="fm-browse">
            Browse the lineup
          </Button>
        }
      />
    );
  } else if (next) {
    const stage = getStageName(next.set.stageId) || '';
    const mins = Math.floor((next.start - nowMs) / 60_000);
    const imminent = mins <= IMMINENT_MIN;
    body = (
      <button
        type="button"
        data-testid="fm-next-hero"
        onClick={() => onOpenSet(next.set)}
        aria-label={`Next: ${name(next.set)}${stage ? ` at ${stage}` : ''}, ${fmtStartsIn(next.start, nowMs, timeZone)}. Open details`}
        className={cn(card, 'border-border')}
      >
        <span className="block type-micro text-text-secondary">Next</span>
        <span className="block font-display font-bold text-2xl leading-tight text-text-primary break-words mt-1">
          {name(next.set)}
        </span>
        <span className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 mt-3">
          {stage && (
            <span className="flex items-center gap-1.5 type-label text-text-primary min-w-0">
              <Footprints className="w-4 h-4 shrink-0 text-accent-aqua" aria-hidden="true" />
              <span className="break-words">Head to {stage}</span>
            </span>
          )}
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-2xl font-semibold tabular-nums leading-none',
                imminent ? 'text-accent-coral font-bold' : 'text-accent-aqua',
              )}
            >
              {fmtStartsIn(next.start, nowMs, timeZone)}
            </span>
            <span className="type-numeral text-text-secondary">{fmtZonedClock(next.start, timeZone)}</span>
          </span>
        </span>
      </button>
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
