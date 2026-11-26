import { meetingTimeDisplay, isPending, type resolveFestivalTimeZone } from '@festie/shared';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { meetingPointEditLine } from '@festie/shared/utils';
import { meetingPointKind } from '@festie/shared/constants';
import { Clock, Navigation, Pencil, Repeat, Trash2 } from 'lucide-react';
import { CONCEPT_ICON } from '../../lib/conceptIcons';
import IconButton from '../ui/IconButton';
import SyncMarker from './SyncMarker';

interface MeetingPointCardProps {
  point: CrewMeetingPoint;
  currentUserId: string;
  isOwner: boolean;
  festivalDays: Parameters<typeof meetingTimeDisplay>[2];
  festivalTimeZone: ReturnType<typeof resolveFestivalTimeZone>;
  nowMs: number;
  onToggleComing: (point: CrewMeetingPoint) => void;
  onDirections: (point: CrewMeetingPoint) => void;
  onEdit: (point: CrewMeetingPoint) => void;
  onRemove: (id: string, name: string) => void;
}

export default function MeetingPointCard({
  point: p,
  currentUserId,
  isOwner,
  festivalDays,
  festivalTimeZone,
  nowMs,
  onToggleComing,
  onDirections,
  onEdit,
  onRemove,
}: MeetingPointCardProps) {
  const meta = meetingPointKind(p.type);
  const KindIcon = CONCEPT_ICON[meta.icon];
  // A queued create has no server id yet, so it cannot be edited or removed.
  const canEdit = !isPending(p) && (p.created_by === currentUserId || isOwner);
  const isEmergency = p.type === 'emergency';
  return (
  <div
    className={`p-3 rounded-xl bg-bg-card border animate-[card-in_220ms_var(--ease-out,ease-out)_both] motion-reduce:!animate-none ${isEmergency ? 'border-accent-coral' : 'border-border'}`}
  >
    <div className="flex flex-wrap items-start gap-x-3">
      <KindIcon
        className={`w-5 h-5 shrink-0 mt-0.5 ${isEmergency ? 'text-accent-coral-strong' : 'text-text-secondary'}`}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-semibold text-text-primary">{p.label}</span>
          <span className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">{meta.label}</span>
        </div>
        <div className="text-sm text-text-secondary mt-0.5">{p.location}</div>
        <SyncMarker item={p} />
        {p.stage_reference && (
          <div className="text-xs text-accent-aqua mt-0.5">Near {p.stage_reference}</div>
        )}
        {p.meet_at &&
          (p.recurs_daily ? (
            // 055: recurring point — show the daily time-of-day badge
            // ("Daily · 3:00 PM") from the shared meetingTime helper.
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent-aqua/15 px-2 py-0.5 text-xs font-medium text-accent-aqua">
              <Repeat className="w-4 h-4" aria-hidden="true" />
              {`Daily · ${meetingTimeDisplay(p.meet_at, true, festivalDays, new Date(), festivalTimeZone).label.replace(/^daily /, '')}`}
            </div>
          ) : (
            <div className="text-xs text-accent-aqua mt-1 inline-flex items-center gap-1">
              <Clock className="w-4 h-4" aria-hidden="true" />
              {meetingTimeDisplay(p.meet_at, false, festivalDays, new Date(), festivalTimeZone).label}
            </div>
          ))}
        {(() => {
          const editLine = meetingPointEditLine(p, { timeZone: festivalTimeZone, now: new Date(nowMs) });
          return editLine ? <div className="text-xs text-text-muted mt-0.5">{editLine}</div> : null;
        })()}
        {!isPending(p) && (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              aria-pressed={(p.coming ?? []).includes(currentUserId)}
              aria-label={`I'll be there: ${p.label}`}
              onClick={() => onToggleComing(p)}
              className="min-h-11 px-3 rounded-full border border-accent-aqua text-sm font-semibold text-text-primary aria-pressed:bg-accent-aqua/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
            >
              {(p.coming ?? []).includes(currentUserId) ? 'Coming' : "I'll be there"}
            </button>
            {(p.coming?.length ?? 0) > 0 && (
              <span className="text-xs text-text-secondary">{p.coming!.length} coming</span>
            )}
          </div>
        )}
      </div>
      {/* Under 480px the buttons drop to their own row so the title keeps the width. */}
      <div className="flex basis-full items-center justify-end gap-1 shrink-0 min-[480px]:basis-auto">
        <IconButton
          label={`Directions to ${p.label}`}
          icon={<Navigation className="w-4 h-4" />}
          onClick={() => onDirections(p)}
        />
        {canEdit && (
          <>
            <IconButton
              label="Edit meeting point"
              icon={<Pencil className="w-4 h-4" />}
              onClick={() => onEdit(p)}
            />
            <IconButton
              label={`Remove meeting point ${p.label}`}
              variant="danger"
              icon={<Trash2 className="w-4 h-4" />}
              onClick={() => onRemove(p.id, `"${p.label}"`)}
            />
          </>
        )}
      </div>
    </div>
  </div>
  );
}
