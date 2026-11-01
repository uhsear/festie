import { ChevronRight, Home, MapPin, Users } from 'lucide-react';
import {
  fmtStartsIn,
  fmtZonedClock,
  settleUpLine,
  timeAgo,
  type ActiveMeet,
  type CrewWhereabout,
} from '@festie/shared/utils';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import ReformCrewButton from '../crew/ReformCrewButton';
import { cn } from '@/lib/utils';

// The first screenful answers "where is my crew"; the full list is one tap away.
const MAX_ROWS = 5;

function Freshness({ row }: { row: CrewWhereabout }) {
  if (row.sos) {
    return <span className="type-micro text-accent-coral font-bold shrink-0">SOS</span>;
  }
  if (row.live === 'live') {
    return (
      <span className="flex items-center gap-1.5 type-caption text-text-primary shrink-0">
        <span className="w-2 h-2 rounded-full bg-confidence-live" aria-hidden="true" />
        Live
      </span>
    );
  }
  if (row.live === 'stale' && row.liveAt) {
    return (
      <span className="flex items-center gap-1.5 type-caption text-text-secondary shrink-0 tabular-nums">
        <span className="w-2 h-2 rounded-full border-2 border-confidence-aging" aria-hidden="true" />
        Seen {timeAgo(row.liveAt)}
      </span>
    );
  }
  return null;
}

interface CrewProps {
  crewName: string;
  rows: CrewWhereabout[];
  onOpenCrew: () => void;
}

/** Crew members' latest status and live-location freshness, with one tap to Meet. */
export function CrewNowSection({ crewName, rows, onOpenCrew }: CrewProps) {
  const shown = rows.slice(0, MAX_ROWS);
  const more = rows.length - shown.length;
  return (
    <section aria-labelledby="fm-crew-title" className="flex flex-col gap-2" data-testid="fm-crew">
      <h2 id="fm-crew-title" className="type-label font-semibold text-text-primary flex items-center gap-1.5 min-w-0">
        <Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{crewName}</span>
      </h2>
      <div className="rounded-xl border border-border bg-bg-card">
        {shown.length === 0 ? (
          <p className="type-label text-text-secondary p-4">Nobody else in your crew yet.</p>
        ) : (
          <ul className="list-none m-0 p-0 divide-y divide-border">
            {shown.map((row) => (
              <li key={row.userId} className="flex items-center gap-3 px-4 py-2.5 min-h-[52px]">
                <Avatar name={row.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="type-label text-text-primary font-semibold truncate">{row.name}</p>
                  <p className="type-caption text-text-secondary truncate tabular-nums">
                    {row.statusLabel
                      ? `${row.statusLabel}${row.statusAt ? ` · ${timeAgo(row.statusAt)}` : ''}`
                      : 'No status yet'}
                  </p>
                </div>
                <Freshness row={row} />
              </li>
            ))}
          </ul>
        )}
        {more > 0 && <p className="type-caption text-text-secondary px-4 pb-2">+{more} more</p>}
      </div>
      <Button variant="primary" fullWidth onClick={onOpenCrew} data-testid="fm-find-crew">
        Find your crew
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </Button>
    </section>
  );
}

interface MeetProps {
  meet: ActiveMeet | null;
  nowMs: number;
  timeZone?: string;
  onOpenMeet: () => void;
}

/** The active meeting point, or Home Base, as one tappable row. */
export function MeetNowCard({ meet, nowMs, timeZone, onOpenMeet }: MeetProps) {
  const Icon = meet?.kind === 'home-base' ? Home : MapPin;
  let when: string | null = null;
  if (meet?.atMs) {
    when =
      meet.atMs > nowMs
        ? `${fmtZonedClock(meet.atMs, timeZone)} · ${fmtStartsIn(meet.atMs, nowMs, timeZone)}`
        : `${fmtZonedClock(meet.atMs, timeZone)} · now`;
  } else if (meet?.timeText) {
    when = meet.timeText;
  }
  return (
    <section aria-labelledby="fm-meet-title" className="flex flex-col gap-2" data-testid="fm-meet">
      <h2 id="fm-meet-title" className="type-micro text-text-secondary">
        Where we meet
      </h2>
      <button
        type="button"
        onClick={onOpenMeet}
        aria-label={meet ? `${meet.label}${meet.location ? `, ${meet.location}` : ''}${when ? `, ${when}` : ''}. Open meeting points` : 'No meeting point set. Add one'}
        className={cn(
          'flex items-center gap-3 w-full text-left rounded-xl border border-border bg-bg-card p-4 min-h-[64px]',
          'transition-colors duration-[var(--duration-med)] hover:bg-bg-card-hover motion-reduce:transition-none',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
        )}
      >
        <Icon className="w-6 h-6 shrink-0 text-accent-aqua" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {meet ? (
            <>
              <span className="block type-title text-text-primary break-words">{meet.label}</span>
              {meet.location && meet.location !== meet.label && (
                <span className="block type-label text-text-secondary break-words">{meet.location}</span>
              )}
              {when && <span className="block type-numeral text-text-primary mt-1">{when}</span>}
            </>
          ) : (
            <>
              <span className="block type-label text-text-primary font-semibold">No meeting point yet</span>
              <span className="block type-caption text-text-secondary">Add one so the crew knows where to regroup.</span>
            </>
          )}
        </span>
        <ChevronRight className="w-5 h-5 shrink-0 text-text-secondary" aria-hidden="true" />
      </button>
    </section>
  );
}

interface PromptProps {
  title: string;
  body: string;
  cta: string;
  onAction: () => void;
}

interface WrapUpProps {
  crewName: string;
  balance: number;
  onSettle: () => void;
  crewId: string;
  festivalId?: string;
}

/** Replaces the crew list once the festival is over: settle up, or start again. */
export function CrewWrapUpCard({ crewName, balance, onSettle, crewId, festivalId }: WrapUpProps) {
  return (
    <section aria-labelledby="fm-crew-wrapup" className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-3" data-testid="fm-crew-wrapup">
      <div className="flex items-start gap-3">
        <Users className="w-6 h-6 shrink-0 text-accent-aqua mt-0.5" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="fm-crew-wrapup" className="type-title text-text-primary break-words">
            Wrap up with {crewName}
          </h2>
          <p className="type-label text-text-secondary mt-1">{settleUpLine(balance)}</p>
        </div>
      </div>
      <Button variant="primary" fullWidth onClick={onSettle}>
        {Math.abs(balance) > 0.01 ? 'Settle up' : 'See expenses'}
      </Button>
      <ReformCrewButton crewId={crewId} sourceFestivalId={festivalId} crewName={crewName} />
    </section>
  );
}

/** Crew slot for a guest, or a user without a crew. */
export function CrewPrompt({ title, body, cta, onAction }: PromptProps) {
  return (
    <section aria-labelledby="fm-crew-prompt" className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-3" data-testid="fm-crew-prompt">
      <div className="flex items-start gap-3">
        <Users className="w-6 h-6 shrink-0 text-accent-aqua mt-0.5" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="fm-crew-prompt" className="type-title text-text-primary">
            {title}
          </h2>
          <p className="type-label text-text-secondary mt-1">{body}</p>
        </div>
      </div>
      <Button variant="primary" fullWidth onClick={onAction}>
        {cta}
      </Button>
    </section>
  );
}
