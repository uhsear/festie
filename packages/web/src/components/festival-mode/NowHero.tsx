import type { ReactNode } from 'react';
import { CalendarClock, Footprints, Music } from 'lucide-react';
import type { FestivalSet } from '@festie/shared/types';
import {
  artistDisplayName,
  fmtStartsIn,
  fmtTimeLeft,
  fmtZonedClock,
  festivalStartCopy,
  startsInIsRelative,
  type DayOfSet,
  type NowNextSelection,
  festivalTint,
  type StageWalk,
} from '@festie/shared/utils';
import { COPY, PRIORITY_SYMBOLS } from '@festie/shared/constants';
import { CONCEPT_ICON } from '../../lib/conceptIcons';
import Button from '../ui/Button';
import PriorityIcon from '../ui/PriorityIcon';
import { cn } from '@/lib/utils';
import ArtistName, { RowOpenButton } from '../features/ArtistName';

// Countdown turns amber and bold when a set is this close, so "go now" reads
// at a glance in a crowd.
const IMMINENT_MIN = 5;
// A live set this close to its end gets the danger red, not amber: amber is brown in Daylight, which is off palette on the green Now card.
// text.danger clears 4.5:1 on the card in Stage (6.7:1) and 7:1 in Daylight (8.2:1).
const ENDING_SOON_MIN = 10;

interface Props {
  selection: NowNextSelection;
  nowMs: number;
  timeZone?: string;
  b2bSeparator?: string;
  /** True when NOW/NEXT come from the whole lineup (guest). */
  lineupMode: boolean;
  getStageName: (stageId: string) => string | undefined;
  /** Resolved CSS colour for a stage; drawn as the card's leading rail, never as text. */
  getStageColor?: (stageId: string) => string;
  /** Tints the Wrap thumbnail once the festival is over. Never rendered as text. */
  festivalName?: string;
  onOpenSet: (set: FestivalSet) => void;
  onBrowse: () => void;
  onWrap?: () => void;
  /** Walk to the next set's stage, when a recent fix exists. */
  walk?: StageWalk | null;
}

// The lead object: the set name in ink. The stage colour rides a rail, never the text, because the raw stage hues fail contrast on both themes.
const LEAD_NAME = 'block type-heading text-text-primary break-words';

/** The stage colour as a 6px rail on the card's leading edge. Decorative: the stage name is always written out. */
function StageRail({ color }: { color?: string }) {
  if (!color) return null;
  return <span aria-hidden="true" data-testid="fm-stage-rail" className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} />;
}

/** Small stand-in for the Wrap poster (9:16, festival tint). Decorative; the Wrap button carries the action. */
function WrapThumb({ festivalName }: { festivalName?: string }) {
  const tint = festivalTint(festivalName);
  return (
    <span
      aria-hidden="true"
      data-testid="fm-wrap-thumb"
      className="shrink-0 w-[54px] h-24 rounded-md border border-border"
      style={{ background: tint.bg, boxShadow: `inset 0 24px 24px -16px ${tint.active}` }}
    />
  );
}

const card =
  'fm-card-enter motion-reduce:animate-none relative block w-full text-left rounded-lg border bg-bg-card p-4 transition-[background-color,scale] duration-(--duration-med) ease-(--ease-out) hover:bg-bg-card-hover press-scale motion-reduce:transition-none';

function Quiet({ icon, title, body, action, lead }: { icon: ReactNode; title: string; body?: string; action?: ReactNode; lead?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-4 flex flex-col gap-3" data-testid="fm-now-empty">
      {lead && (
        <p className="type-display-lg text-text-primary tabular-nums break-words" data-testid="fm-lead-countdown">
          {lead}
        </p>
      )}
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
  getStageColor,
  festivalName,
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
        {current.map(({ set, end, priority }: DayOfSet) => {
          const stage = getStageName(set.stageId) || '';
          const endingSoon = end - nowMs <= ENDING_SOON_MIN * 60_000;
          return (
            <div
              key={set.id}
              data-testid="fm-now-card"
              className={cn(card, 'overflow-hidden pl-5 border-live-fill/60 shadow-[0_6px_24px_-8px_var(--color-live-ring)]')}
            >
              <StageRail color={getStageColor?.(set.stageId)} />
              <RowOpenButton
                onClick={() => onOpenSet(set)}
                label={`${name(set)} playing now${stage ? ` at ${stage}` : ''}, ${fmtTimeLeft(end, nowMs)}. Open details`}
              />
              <span className={LEAD_NAME}>
                <ArtistName set={set} separator={b2bSeparator} />
              </span>
              <span className="flex items-baseline justify-between gap-3 mt-1">
                <span className="min-w-0 type-label text-text-secondary">
                  {stage ? `${stage} · ` : ''}
                  <span data-testid="fm-until" className="whitespace-nowrap">until {fmtZonedClock(end, timeZone)}</span>
                  {priority && (
                    <span className="inline-flex items-center gap-1 ml-2 align-middle text-text-primary">
                      <PriorityIcon priority={priority} className="w-3.5 h-3.5" />
                      {PRIORITY_SYMBOLS[priority].short}
                    </span>
                  )}
                </span>
                <span
                  className={cn('shrink-0 type-heading tabular-nums', endingSoon ? 'text-text-danger' : 'text-text-primary')}
                  data-testid="fm-lead-countdown"
                >
                  {fmtTimeLeft(end, nowMs)}
                </span>
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
        {...festivalStartCopy(startsAt, startsAtTimed, nowMs, timeZone)}
      />
    );
  } else if (phase === 'after') {
    body = (
      <Quiet
        icon={<WrapThumb festivalName={festivalName} />}
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
      <div key={next.set.id} data-testid="fm-next-hero" className={cn(card, 'overflow-hidden pl-5 border-border')}>
        <StageRail color={getStageColor?.(next.set.stageId)} />
        <RowOpenButton
          onClick={() => onOpenSet(next.set)}
          label={`Next: ${name(next.set)}${stage ? ` at ${stage}` : ''}, ${startsIn}${walk ? `, ${walk.minutes} minute walk${walk.late ? ', leave now' : ''}` : ''}. Open details`}
        />
        <span className="block type-micro text-text-secondary">Next</span>
        <span className={cn(LEAD_NAME, 'mt-1')}>
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
              data-testid="fm-lead-countdown"
              className={cn(
                'type-display-xl tabular-nums leading-none',
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
        {phase === 'before' ? COPY.nowNext.comingUp : lineupMode ? 'Now on the lineup' : 'Now'}
      </h2>
      {body}
    </section>
  );
}
